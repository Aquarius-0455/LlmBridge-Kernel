const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const COMMAND_WHITELIST = require('./commandWhitelist');
const { MAX_TOOL_OUTPUT, COMMAND_TIMEOUT } = require('../config/constants');
const logger = require('../lib/logger');
const mcpManager = require('../mcp/mcpManager');

function truncateOutput(result) {
  const str = String(result);
  if (str.length <= MAX_TOOL_OUTPUT) return str;
  const skipped = str.length - 4000;
  return `${str.slice(0, 2000)}\n\n[... 中间约 ${skipped} 字符已被系统自动截断，避免上下文溢出 ...]\n\n${str.slice(-2000)}`;
}

async function executeTool(name, args, requestApproval) {
  try {
    // ── Human-in-the-Loop Approval Check ────────────────────────
    if (requestApproval && (name === 'delete_file' || name === 'run_command')) {
      const approved = await requestApproval(name, args);
      if (!approved) {
        return `[Error] 拒绝执行：该操作未获得用户许可。`;
      }
    }

    // ── 信息获取类 ────────────────────────────────────────
    if (name === 'read_file') {
      if (!args.path) return '[Error] 缺少 path 参数';
      const output = fs.readFileSync(args.path, 'utf8');
      return truncateOutput(output);
    }
    if (name === 'list_dir') {
      if (!args.path) return '[Error] 缺少 path 参数';
      const entries = fs.readdirSync(args.path, { withFileTypes: true });
      const output = entries.map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`).join('\n');
      return truncateOutput(output);
    }
    if (name === 'get_current_time') {
      return new Date().toLocaleString('zh-CN');
    }

    // ── 执行操作类 ────────────────────────────────────────
    if (name === 'write_file') {
      if (!args.path || args.content === undefined) return '[Error] 缺少 path 或 content 参数';
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
      const rootDir = path.join(__dirname, '../../');
      const blocked = ['C:\\Windows', 'C:\\System', '/etc', '/usr', '/bin', '/sbin', rootDir];
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
      const allowed = COMMAND_WHITELIST.some(prefix => args.command.trim().startsWith(prefix));
      if (!allowed) {
        return `[Error] 命令 "${args.command}" 不在白名单内，已拦截。允许的命令前缀: ${COMMAND_WHITELIST.join(', ')}`;
      }
      const cwd = args.cwd || path.join(__dirname, '../../');
      
      // Async non-blocking execution with timeout
      const { stdout, stderr } = await exec(args.command, { cwd, timeout: COMMAND_TIMEOUT });
      const combined = (stdout || '') + (stderr || '');
      return truncateOutput(combined || '[Success] 命令执行完毕（无输出）');
    }

    if (mcpManager.isMcpTool(name)) {
      const mcpResult = await mcpManager.callMcpTool(name, args);
      return truncateOutput(mcpResult);
    }

    return `[Error] 未知工具: ${name}`;
  } catch (e) {
    return `[Error] 工具执行失败: ${e.message}`;
  }
}

module.exports = {
  executeTool,
  truncateOutput
};
