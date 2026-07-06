const express = require('express');
const router = express.Router();
const { loadConfig } = require('../config/configService');
const { runAgentLoop } = require('../agent/agentLoop');
const { pendingApprovals } = require('../agent/approvalRegistry');
const { sanitizeMessages, buildAnthropicRequest, buildOpenAIRequest } = require('../llm/llmClient');
const { parseStreamResponse } = require('../stream/streamParser');
const logger = require('../lib/logger');

router.post('/chat', async (req, res) => {
  const { messages, useFastModel, effort } = req.body;
  const config = loadConfig();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendLog = (level, message) => {
    const timestamp = new Date().toLocaleTimeString();
    sendSSE({ type: 'log', timestamp, level, message });
    logger[level](message);
  };

  sendLog('info', `开始进行大模型流式调用与降级分析...`);

  // Build list of channels to try directly from the fallbackChain priority list
  const channelsToTry = [];
  config.fallbackChain.forEach(id => {
    const channel = config.channels.find(c => c.id === id);
    if (channel) {
      channelsToTry.push(channel);
    }
  });

  if (channelsToTry.length === 0) {
    sendSSE({ type: 'error', message: "没有配置可用的降级链通道。" });
    return res.end();
  }

  // ── 注入 System Prompt ──────────────────────────────────────────
  // 将系统提示词作为第一条消息插入到对话历史中
  // 如果 config.systemPrompt 为空，则不注入，避免发送空 system 消息
  const systemPrompt = (config.systemPrompt || '').trim();
  const messagesWithSystem = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  // ── Switch agentMode ──────────────────────────────────────────
  if (config.agentMode) {
    try {
      await runAgentLoop({ messages: messagesWithSystem, config, channelsToTry, sendSSE, sendLog });
    } catch (err) {
      sendLog('error', `[动脑] 发生未捕获异常: ${err.message}`);
      sendSSE({ type: 'error', message: err.message });
    }
    return res.end();
  }

  // ── Original pipeline mode (agentMode=false) ──────────────────
  for (let i = 0; i < channelsToTry.length; i++) {
    const channel = channelsToTry[i];
    const modelToUse = (useFastModel && channel.fastModelName) ? channel.fastModelName : channel.modelName;

    sendLog('info', `尝试调用通道: [${channel.name}] (决议模型: ${modelToUse} | 设定努力度: ${effort || 'none'}) - URL: ${channel.baseUrl}`);

    try {
      if (!channel.apiKey && channel.id !== 'local-ollama') {
        throw new Error("API Key 未配置，跳过请求。");
      }

      const isAnthropic = channel.baseUrl.includes('api.anthropic.com');
      const sanitizedMessages = sanitizeMessages(messagesWithSystem, modelToUse);
      
      const { url, headers, body } = isAnthropic
        ? buildAnthropicRequest(channel, sanitizedMessages, modelToUse, effort, true)
        : buildOpenAIRequest(channel, sanitizedMessages, false, modelToUse, effort, true);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP Error ${response.status}: ${errorText || response.statusText}`);
      }

      sendLog('success', `通道 [${channel.name}] 连接成功，开始流式输出字符...`);
      
      // Parse stream chunks and send response SSE
      await parseStreamResponse(response, sendSSE, sendLog);

      sendLog('success', `流式输出完毕。通道: [${channel.name}]`);
      sendSSE({ type: 'done', channelId: channel.id, channelName: channel.name, modelName: channel.modelName });
      return res.end();

    } catch (error) {
      sendLog('error', `通道 [${channel.name}] 发生异常。原因: ${error.message}`);
      
      if (i < channelsToTry.length - 1) {
        sendLog('warn', `触发自动降级机制 ➔ 尝试备用链中的下一个通道...`);
      } else {
        sendLog('error', `降级链中所有通道均尝试失败。无法完成对话。`);
        sendSSE({ type: 'error', message: "All models in the fallback chain failed." });
        return res.end();
      }
    }
  }
});

// Human-in-the-Loop Callback Endpoint
router.post('/confirm', (req, res) => {
  const { requestId, approved } = req.body;
  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId' });
  }

  const resolve = pendingApprovals.get(requestId);
  if (resolve) {
    resolve(approved);
    pendingApprovals.delete(requestId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Request not found or already processed' });
  }
});

module.exports = router;
