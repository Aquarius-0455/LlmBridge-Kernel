const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../config.json');

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
  agentMode: false,
  agentMaxTurns: 10,
  systemPrompt: `你是一个运行在 Windows 操作系统上的高效自动化编程助理。

【核心行为规范】
1. 执行命令时，始终使用 Windows 兼容命令（dir、type、findstr 等），文件路径使用反斜杠 \\
2. 调用工具时保持极简风格，不要输出冗余的"我现在要..."解释性文字
3. 遇到工具调用错误时，先分析错误原因，尝试换一种方式完成任务，不要重复同样的失败命令
4. 任务全部完成后，统一给出简短的总结，不超过 3 句话
5. 如果任务无法完成，请直接告知原因和建议，不要一直重试`,
  mcpEnabled: false,
  mcpServers: {
    "fetch": {
      "id": "fetch",
      "name": "Web 网页抓取 (Fetch)",
      "type": "stdio",
      "enabled": false,
      "command": "npx",
      "args": ["-y", "mcp-fetch-server"],
      "env": {}
    },
    "brave-search": {
      "id": "brave-search",
      "name": "Brave 网页搜索",
      "type": "stdio",
      "enabled": false,
      "command": "npx",
      "args": ["-y", "@brave/brave-search-mcp-server"],
      "env": {
        "BRAVE_API_KEY": ""
      }
    },
    "sqlite": {
      "id": "sqlite",
      "name": "SQLite 数据库只读浏览器",
      "type": "stdio",
      "enabled": false,
      "command": "npx",
      "args": ["-y", "@mokei/mcp-sqlite"],
      "env": {}
    }
  }
};

const MAX_TOOL_OUTPUT = 6000;
const COMMAND_TIMEOUT = 15000;
const HEALTH_POLL_INTERVAL = 5000;

module.exports = {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  MAX_TOOL_OUTPUT,
  COMMAND_TIMEOUT,
  HEALTH_POLL_INTERVAL
};
