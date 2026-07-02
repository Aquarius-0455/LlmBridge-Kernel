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
  fallbackChain: ["deepseek-pro", "deepseek-flash", "gemini-compat", "local-ollama"],
  // ── Agent 模式开关（默认关闭，不影响现有纯管道逻辑）──
  agentMode: false,
  agentMaxTurns: 10  // Agent 模式最大思考轮数
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 【第一阶段】工具库定义（Agent 模式专用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 工具说明书：告诉大模型它能调用哪些工具
const AGENT_TOOLS = [
  // ── 信息获取类 ──────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本地文件内容，用于查阅代码、配置文件等',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件的绝对路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出指定目录下的所有文件和子目录',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录的绝对路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前系统时间',
      parameters: { type: 'object', properties: {} }
    }
  },
  // ── 执行操作类 ──────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '将内容写入本地文件（不存在则创建，已存在则覆盖）',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: '文件的绝对路径' },
          content: { type: 'string', description: '要写入的文本内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_dir',
      description: '创建目录（自动创建所有中间层级，等同于 mkdir -p）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要创建的目录绝对路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除指定的文件（不可删除目录，不可删除系统关键路径）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要删除的文件绝对路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在服务器上执行终端命令（仅限白名单内的安全命令，如 git、npm、node、ls、cat、echo）',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令字符串，例如 "git status" 或 "npm install"' },
          cwd:     { type: 'string', description: '（可选）命令的工作目录，默认为项目根目录' }
        },
        required: ['command']
      }
    }
  }
];

// 安全命令白名单前缀（run_command 只允许以下开头的命令）
const COMMAND_WHITELIST = ['git ', 'npm ', 'node ', 'ls', 'dir', 'cat ', 'echo ', 'pwd', 'type ', 'cd '];

// 工具实现体：Node.js 真实执行逻辑
async function executeTool(name, args) {
  const { execSync } = require('child_process');
  try {
    // ── 信息获取类 ────────────────────────────────────────
    if (name === 'read_file') {
      if (!args.path) return '[Error] 缺少 path 参数';
      return fs.readFileSync(args.path, 'utf8');
    }
    if (name === 'list_dir') {
      if (!args.path) return '[Error] 缺少 path 参数';
      const entries = fs.readdirSync(args.path, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`).join('\n');
    }
    if (name === 'get_current_time') {
      return new Date().toLocaleString('zh-CN');
    }

    // ── 执行操作类 ────────────────────────────────────────
    if (name === 'write_file') {
      if (!args.path || args.content === undefined) return '[Error] 缺少 path 或 content 参数';
      // 自动创建父目录
      const dir = path.dirname(args.path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(args.path, args.content, 'utf8');
      return `[Success] 已写入文件: ${args.path}（${args.content.length} 字符）`;
    }
    if (name === 'create_dir') {
      if (!args.path) return '[Error] 缺少 path 参数';
      fs.mkdirSync(args.path, { recursive: true });
      return `[Success] 目录已创建: ${args.path}`;
    }
    if (name === 'delete_file') {
      if (!args.path) return '[Error] 缺少 path 参数';
      // 安全门：禁止删除系统关键路径
      const blocked = ['C:\\Windows', 'C:\\System', '/etc', '/usr', '/bin', '/sbin', __dirname];
      if (blocked.some(b => args.path.startsWith(b))) {
        return '[Error] 拒绝删除系统关键路径，操作已被安全门拦截';
      }
      const stat = fs.statSync(args.path);
      if (stat.isDirectory()) return '[Error] 不能删除目录，只能删除文件';
      fs.unlinkSync(args.path);
      return `[Success] 文件已删除: ${args.path}`;
    }
    if (name === 'run_command') {
      if (!args.command) return '[Error] 缺少 command 参数';
      // 安全门：只允许白名单内的命令前缀
      const allowed = COMMAND_WHITELIST.some(prefix => args.command.trim().startsWith(prefix));
      if (!allowed) {
        return `[Error] 命令 "${args.command}" 不在白名单内，已拦截。允许的命令前缀: ${COMMAND_WHITELIST.join(', ')}`;
      }
      const cwd = args.cwd || __dirname;
      const output = execSync(args.command, { cwd, encoding: 'utf8', timeout: 15000 });
      return output || '[Success] 命令执行完毕（无输出）';
    }

    return `[Error] 未知工具: ${name}`;
  } catch (e) {
    return `[Error] 工具执行失败: ${e.message}`;
  }
}

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

// GET agent mode status
app.get('/api/agent-mode', (req, res) => {
  const config = loadConfig();
  res.json({ agentMode: config.agentMode || false, agentMaxTurns: config.agentMaxTurns || 10 });
});

// POST toggle agent mode
app.post('/api/agent-mode', (req, res) => {
  const config = loadConfig();
  const { agentMode, agentMaxTurns } = req.body;
  config.agentMode = typeof agentMode === 'boolean' ? agentMode : config.agentMode;
  if (agentMaxTurns) config.agentMaxTurns = agentMaxTurns;
  saveConfig(config);
  res.json({ success: true, agentMode: config.agentMode, agentMaxTurns: config.agentMaxTurns });
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 【开关判断】agentMode=true → 走 ReAct 思考循环
  //            agentMode=false → 走原有纯管道逻辑（不改动任何代码）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (config.agentMode) {
    // 【第二阶段】ReAct Agent 思考循环（三段式软上限）
    const MAX_TURNS = config.agentMaxTurns || 10;
    const conversationHistory = [...messages];
    let turn = 0;
    let toolErrorCounts = {};       // 工具失败计数
    let earlyWarningSent = false;   // 阶段一：早期警告
    let finalWarningSent = false;   // 阶段二：最终警告
    let forceFinishSent = false;    // 阶段三：强制结束

    log('info', `动脑模式已开启 | 最大轮数: ${MAX_TURNS}`);

    // 通用：向所有 fallback 通道发起一次非流式请求（Agent 需要完整 JSON 分析工具调用）
    const callLLM = async (msgs, useTools) => {
      for (const channel of channelsToTry) {
        try {
          if (!channel.apiKey && channel.id !== 'local-ollama') throw new Error('API Key 未配置');
          const modelToUse = (useFastModel && channel.fastModelName) ? channel.fastModelName : channel.modelName;
          const isAnthropic = channel.baseUrl.includes('api.anthropic.com');
          if (isAnthropic) throw new Error('动脑模式暂不支持 Anthropic 通道，请使用 OpenAI 兼容通道');

          const modelLower = modelToUse.toLowerCase();
          const isTextOnly = modelLower.includes('deepseek') || modelLower.includes('llama');
          const sanitizedMsgs = msgs.map(msg => {
            if (isTextOnly && Array.isArray(msg.content)) {
              const text = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
              return { ...msg, content: text || ' ' };
            }
            return msg;
          });

          const body = { model: modelToUse, messages: sanitizedMsgs, stream: false };
          if (useTools) { body.tools = AGENT_TOOLS; body.tool_choice = 'auto'; }

          const resp = await fetch(`${channel.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${channel.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t}`); }
          return await resp.json();
        } catch (e) {
          log('warn', `[动脑] 通道 [${channel.name}] 失败: ${e.message}，尝试下一个...`);
        }
      }
      throw new Error('所有通道均失败');
    };

    try {
      while (true) {
        turn++;

        // ── 三段式软上限机制 ──────────────────────────
        // 阶段一：剩余 3 轮时发早期警告
        if (!earlyWarningSent && turn >= MAX_TURNS - 3) {
          earlyWarningSent = true;
        log('warn', `[动脑 第${turn}轮] 轮数预警：仅剩约 3 轮，请加速收尾`);
          conversationHistory.push({ role: 'user', content: '【轮数预警】剩余轮次有限，请聚焦核心任务，尽快给出最终答案。' });
        }
        // 阶段二：剩余 1 轮时发最终警告
        if (!finalWarningSent && turn >= MAX_TURNS - 1) {
          finalWarningSent = true;
          log('warn', `[动脑 第${turn}轮] 最终警告：仅剩 1 轮，立即输出结果！`);
          conversationHistory.push({ role: 'user', content: '【最终警告】仅剩最后 1 轮。请立即停止工具调用，直接输出你的最终答案。' });
        }
        // 阶段三：超出上限，强制结束
        if (turn > MAX_TURNS) {
          if (!forceFinishSent) {
            forceFinishSent = true;
            log('warn', `[动脑] 已达最大轮数 ${MAX_TURNS}，强制注入结束指令...`);
            conversationHistory.push({ role: 'user', content: '【系统强制结束】已超出最大执行轮数。请基于已有信息立即给出最终答案，不得再调用任何工具。' });
            const forceResp = await callLLM(conversationHistory, false);
            const forceText = forceResp?.choices?.[0]?.message?.content || '（强制结束，无输出）';
            sendSSE({ type: 'content', text: forceText });
          }
          break;
        }
        // ───────────────────────────────────────────────────────

        log('info', `[动脑 第${turn}/${MAX_TURNS}轮] 思考中...`);
        const response = await callLLM(conversationHistory, true);
        const choice = response?.choices?.[0];
        const finishReason = choice?.finish_reason;
        const assistantMsg = choice?.message;

        if (!assistantMsg) { log('error', '[动脑] 模型返回了空消息，终止'); break; }

        // 把模型的回复存入对话历史
        conversationHistory.push(assistantMsg);

        if (finishReason === 'tool_calls' && assistantMsg.tool_calls?.length > 0) {
          // ── 大模型决定调工具 ──────────────────────────────────
          for (const toolCall of assistantMsg.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs = {};
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch (_) {}

            log('info', `[动脑] 🔧 调用工具: ${toolName} | 参数: ${JSON.stringify(toolArgs)}`);

            const toolResult = await executeTool(toolName, toolArgs);
            const isError = toolResult.startsWith('[Error]');

            // 工具失败计数
            if (isError) {
              toolErrorCounts[toolName] = (toolErrorCounts[toolName] || 0) + 1;
              if (toolErrorCounts[toolName] >= 3) {
                log('warn', `[动脑] 工具 [${toolName}] 连续失败 3 次，注入放弃提示`);
                conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: `[系统提示] 工具 ${toolName} 已多次失败，请换用其他方式完成任务。` });
                continue;
              }
            }

            log(isError ? 'warn' : 'success', `[动脑] 工具结果 (${toolName}): ${String(toolResult).slice(0, 100)}...`);
            conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: String(toolResult) });
          }
          // 工具执行完毕，继续下一轮思考

        } else {
          // ── 大模型给出最终答案 → 推给前端 ────────────────────
          const finalText = assistantMsg.content || '';
          log('success', `[动脑 第${turn}轮] 任务完成，推送最终答案`);
          sendSSE({ type: 'content', text: finalText });
          break;
        }
      }

      sendSSE({ type: 'done', agentMode: true, totalTurns: turn });
      return res.end();

    } catch (agentErr) {
      log('error', `[动脑] 致命错误: ${agentErr.message}`);
      sendSSE({ type: 'error', message: agentErr.message });
      return res.end();
    }
  }

  // -- agentMode=false：原有纯管道逻辑，一行未改 --
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
        
        // Sanitize messages: DeepSeek and standard LLMs often reject multimodal arrays.
        // We strip out 'image_url' and flatten to string if the model is DeepSeek/Llama.
        const modelLower = modelToUse.toLowerCase();
        const isTextOnly = modelLower.includes('deepseek') || modelLower.includes('llama');
        
        const sanitizedMessages = messages.map(msg => {
          if (isTextOnly && Array.isArray(msg.content)) {
            const textContent = msg.content
              .filter(part => part.type === 'text')
              .map(part => part.text)
              .join('\n');
            return { role: msg.role, content: textContent || ' ' };
          }
          return msg;
        });

        requestBody = {
          model: modelToUse,
          messages: sanitizedMessages,
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
