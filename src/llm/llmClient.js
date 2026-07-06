const AGENT_TOOLS = require('../tools/toolDefinitions');
const logger = require('../lib/logger');

function sanitizeMessages(messages, modelName) {
  const modelLower = modelName.toLowerCase();
  const isTextOnly = modelLower.includes('deepseek') || modelLower.includes('llama');
  return messages.map(msg => {
    const newMsg = { ...msg };
    if (isTextOnly && Array.isArray(msg.content)) {
      const textContent = msg.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
      newMsg.content = textContent || ' ';
    }
    return newMsg;
  });
}

function buildAnthropicRequest(channel, msgs, modelName, effort, stream = false) {
  const url = `${channel.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const headers = {
    'x-api-key': channel.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };

  let systemPrompt = '';
  const filteredMessages = [];
  for (const msg of msgs) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      // Claude only accepts 'user' and 'assistant' roles in messages array
      filteredMessages.push({
        role: msg.role,
        content: msg.content
      });
    }
  }

  const body = {
    model: modelName,
    messages: filteredMessages,
    stream: stream,
    max_tokens: 4096
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (effort && effort !== 'none') {
    const budgetMap = { low: 1024, medium: 2048, high: 4096 };
    body.thinking = {
      type: 'enabled',
      budget_tokens: budgetMap[effort]
    };
  }

  return { url, headers, body };
}

function buildOpenAIRequest(channel, msgs, toolsToUse, modelName, effort, stream = false) {
  const url = `${channel.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const headers = {
    'Authorization': `Bearer ${channel.apiKey}`,
    'Content-Type': 'application/json'
  };

  const body = {
    model: modelName,
    messages: msgs,
    stream: stream
  };

  if (toolsToUse && toolsToUse.length > 0) {
    body.tools = toolsToUse;
    body.tool_choice = 'auto';
  }

  if (effort && effort !== 'none') {
    const modelLower = modelName.toLowerCase();
    if (modelLower.includes('claude')) {
      const budgetMap = { low: 1024, medium: 2048, high: 4096 };
      body.thinking = {
        type: 'enabled',
        budget_tokens: budgetMap[effort]
      };
    } else if (modelLower.includes('gemini')) {
      const budgetMap = { low: 1024, medium: 2048, high: 4096 };
      body.thinking_config = {
        thinking_budget: budgetMap[effort]
      };
    } else {
      body.reasoning_effort = effort;
    }
  }

  return { url, headers, body };
}

async function callLLM(channelsToTry, msgs, toolsToUse, useFastModel, effort, sendLog) {
  const log = sendLog || ((level, msg) => logger[level](msg));
  for (const channel of channelsToTry) {
    try {
      if (!channel.apiKey && channel.id !== 'local-ollama') {
        throw new Error('API Key 未配置');
      }

      const modelToUse = (useFastModel && channel.fastModelName) ? channel.fastModelName : channel.modelName;
      const isAnthropic = channel.baseUrl.includes('api.anthropic.com');
      
      if (isAnthropic && toolsToUse && toolsToUse.length > 0) {
        throw new Error('动脑模式暂不支持 Anthropic 通道，请使用 OpenAI 兼容通道');
      }

      const sanitizedMsgs = sanitizeMessages(msgs, modelToUse);
      const { url, headers, body } = isAnthropic
        ? buildAnthropicRequest(channel, sanitizedMsgs, modelToUse, effort, false)
        : buildOpenAIRequest(channel, sanitizedMsgs, toolsToUse, modelToUse, effort, false);

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${t}`);
      }

      return await resp.json();
    } catch (e) {
      log('warn', `通道 [${channel.name}] 失败: ${e.message}，尝试下一个...`);
    }
  }
  throw new Error('所有通道均失败');
}

module.exports = {
  callLLM,
  sanitizeMessages,
  buildAnthropicRequest,
  buildOpenAIRequest
};
