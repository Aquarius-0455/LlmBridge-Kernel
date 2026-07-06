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

module.exports = AGENT_TOOLS;
