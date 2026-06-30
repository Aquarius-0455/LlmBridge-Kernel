const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3300;
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Default configurations
const DEFAULT_CONFIG = {
  channels: [
    {
      id: "deepseek-flash",
      name: "DeepSeek Flash (OpenAI 兼容)",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      modelName: "deepseek-chat"
    },
    {
      id: "deepseek-pro",
      name: "DeepSeek Pro (OpenAI 兼容)",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      modelName: "deepseek-reasoning"
    },
    {
      id: "gemini-compat",
      name: "Google Gemini (OpenAI 兼容端点)",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "",
      modelName: "gemini-1.5-flash"
    },
    {
      id: "local-ollama",
      name: "Local Ollama (本地大模型)",
      baseUrl: "http://localhost:11434",
      apiKey: "ollama",
      modelName: "llama3"
    }
  ],
  fallbackChain: ["deepseek-pro", "deepseek-flash", "gemini-compat", "local-ollama"]
};

// Load or initialize config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading config.json, using defaults", e);
  }
  return DEFAULT_CONFIG;
}

// Save config
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing config.json", e);
  }
}

// GET config
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// POST config
app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  if (!newConfig.channels || !newConfig.fallbackChain) {
    return res.status(400).json({ error: "Invalid configuration structure" });
  }
  saveConfig(newConfig);
  res.json({ success: true, config: newConfig });
});

// POST chat with streaming routing and fallback logic
app.post('/api/chat', async (req, res) => {
  const { messages, useFastModel, effort } = req.body;
  const config = loadConfig();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const log = (level, message) => {
    const timestamp = new Date().toLocaleTimeString();
    sendSSE({ type: 'log', timestamp, level, message });
    console.log(`[${level.toUpperCase()}] ${message}`);
  };

  log('info', `开始进行大模型流式调用与降级分析...`);

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

  // Try calling the channels one by one
  for (let i = 0; i < channelsToTry.length; i++) {
    const channel = channelsToTry[i];
    
    // Resolve which model name to use (main model or fast model)
    const modelToUse = (useFastModel && channel.fastModelName) ? channel.fastModelName : channel.modelName;

    log('info', `尝试调用通道: [${channel.name}] (决议模型: ${modelToUse} | 设定努力度: ${effort || 'none'}) - URL: ${channel.baseUrl}`);

    try {
      if (!channel.apiKey && channel.id !== 'local-ollama') {
        throw new Error("API Key 未配置，跳过请求。");
      }

      const isAnthropic = channel.baseUrl.includes('api.anthropic.com');
      let url, headers, requestBody;

      if (isAnthropic) {
        // Native Anthropic Claude API Setup
        url = `${channel.baseUrl.replace(/\/+$/, '')}/v1/messages`;
        headers = {
          'x-api-key': channel.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        };

        // Extract system prompt from messages if any (Claude expects system prompt at root level)
        let systemPrompt = '';
        const filteredMessages = [];
        for (const msg of messages) {
          if (msg.role === 'system') {
            systemPrompt = msg.content;
          } else {
            // Claude only accepts "user" and "assistant" roles
            filteredMessages.push({
              role: msg.role,
              content: msg.content
            });
          }
        }

        requestBody = {
          model: modelToUse,
          messages: filteredMessages,
          stream: true,
          max_tokens: 4096 // Claude requires max_tokens
        };

        if (systemPrompt) {
          requestBody.system = systemPrompt;
        }

        // Handle Thinking parameter mapping for Claude 3.7
        if (effort && effort !== 'none') {
          const budgetMap = { low: 1024, medium: 2048, high: 4096 };
          requestBody.thinking = {
            type: 'enabled',
            budget_tokens: budgetMap[effort]
          };
        }
      } else {
        // Standard OpenAI Compatible Setup
        url = `${channel.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
        headers = {
          'Authorization': `Bearer ${channel.apiKey}`,
          'Content-Type': 'application/json'
        };
        
        requestBody = {
          model: modelToUse,
          messages: messages,
          stream: true
        };

        // Apply reasoning parameters only if effort is not 'none'
        if (effort && effort !== 'none') {
          const modelLower = modelToUse.toLowerCase();
          
          if (modelLower.includes('claude')) {
            const budgetMap = { low: 1024, medium: 2048, high: 4096 };
            requestBody.thinking = {
              type: 'enabled',
              budget_tokens: budgetMap[effort]
            };
          } else if (modelLower.includes('gemini')) {
            const budgetMap = { low: 1024, medium: 2048, high: 4096 };
            requestBody.thinking_config = {
              thinking_budget: budgetMap[effort]
            };
          } else {
            requestBody.reasoning_effort = effort;
          }
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP Error ${response.status}: ${errorText || response.statusText}`);
      }

      log('success', `通道 [${channel.name}] 连接成功，开始流式输出字符...`);

      // Read the stream chunks and forward them
      const reader = response.body;
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let hasStreamData = false;
      let rawAccumulated = ''; // Accumulate everything in case it's a raw JSON response
      
      for await (const chunk of reader) {
        const chunkStr = decoder.decode(chunk, { stream: true });
        rawAccumulated += chunkStr;
        buffer += chunkStr;
        
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('data:')) {
            hasStreamData = true;
            const rawData = trimmed.slice(5).trim();
            if (rawData === '[DONE]') continue;

            try {
              const dataJson = JSON.parse(rawData);
              
              // 1. Check for usage statistics
              if (dataJson.usage) {
                sendSSE({ type: 'usage', usage: dataJson.usage });
              }

              // 2. Extract reasoning/thinking delta content
              let thinking = dataJson.choices?.[0]?.delta?.reasoning_content || '';
              if (thinking) {
                sendSSE({ type: 'thinking', text: thinking });
              }

              // 3. Extract text content
              let text = dataJson.choices?.[0]?.delta?.content || '';
              
              if (!text && dataJson.delta?.text) {
                text = dataJson.delta.text;
              }
              if (!text && dataJson.content) {
                text = dataJson.content;
              }
              if (!text && dataJson.text) {
                text = dataJson.text;
              }

              if (text) {
                sendSSE({ type: 'content', text });
              }
            } catch (e) {
              log('warn', `流式行解析失败。Raw: "${rawData.slice(0, 100)}..." | Error: ${e.message}`);
            }
          }
        }
      }

      // Flush trailing bytes from decoder
      const flushStr = decoder.decode();
      buffer += flushStr;
      rawAccumulated += flushStr;

      // Handle remaining buffer for stream
      if (hasStreamData && buffer && buffer.trim().startsWith('data:')) {
        const rawData = buffer.trim().slice(5).trim();
        if (rawData !== '[DONE]') {
          try {
            const dataJson = JSON.parse(rawData);
            let text = dataJson.choices?.[0]?.delta?.content || '';
            if (!text && dataJson.delta?.text) {
              text = dataJson.delta.text;
            }
            if (!text && dataJson.content) {
              text = dataJson.content;
            }
            if (!text && dataJson.text) {
              text = dataJson.text;
            }
            if (text) {
              sendSSE({ type: 'content', text });
            }
          } catch (e) {}
        }
      }

      // 4. Fallback: If we completed the stream but NEVER saw any "data:" lines,
      // it means the provider returned a standard blocking JSON response. Let's parse it.
      if (!hasStreamData && rawAccumulated.trim()) {
        const trimmedRaw = rawAccumulated.trim();
        log('info', `未检测到流式 data: 前缀，尝试以同步 JSON 格式解析响应...`);
        try {
          const syncJson = JSON.parse(trimmedRaw);
          
          // Try standard OpenAI chat completion JSON keys
          let text = syncJson.choices?.[0]?.message?.content || '';
          let thinking = syncJson.choices?.[0]?.message?.reasoning_content || '';
          
          if (!text && syncJson.content) {
            text = syncJson.content;
          }
          
          if (thinking) {
            sendSSE({ type: 'thinking', text: thinking });
          }
          if (text) {
            sendSSE({ type: 'content', text: text });
          } else {
            log('warn', `同步 JSON 中未找到 content。返回数据: ${trimmedRaw.slice(0, 300)}`);
          }
          if (syncJson.usage) {
            sendSSE({ type: 'usage', usage: syncJson.usage });
          }
        } catch (err) {
          log('error', `同步 JSON 解析失败。原始响应内容: "${trimmedRaw.slice(0, 500)}..." | 错误: ${err.message}`);
        }
      }

      log('success', `流式输出完毕。通道: [${channel.name}]`);
      sendSSE({ type: 'done', channelId: channel.id, channelName: channel.name, modelName: channel.modelName });
      return res.end();

    } catch (error) {
      log('error', `通道 [${channel.name}] 发生异常。原因: ${error.message}`);
      
      if (i < channelsToTry.length - 1) {
        log('warn', `触发自动降级机制 ➔ 尝试备用链中的下一个通道...`);
      } else {
        log('error', `降级链中所有通道均尝试失败。无法完成对话。`);
        sendSSE({ type: 'error', message: "All models in the fallback chain failed." });
        return res.end();
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  LlmBridge Streaming Multi-Model Gateway is running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
