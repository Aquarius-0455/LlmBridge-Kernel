const { callLLM } = require('../llm/llmClient');
const logger = require('../lib/logger');

const COMPRESSION_SYSTEM_PROMPT = `You are a conversation compressor. Your task is to create a structured summary of the conversation history between a user and an AI assistant.

Your summary MUST preserve:
- Key decisions made and their rationale
- Code changes summary (file paths, what was modified, why)
- Current task status and any pending work
- User preferences and constraints mentioned
- Important context that would be needed to continue the conversation
- Error messages or issues encountered and their resolutions

Your summary should DISCARD:
- Redundant information and repeated content
- Detailed tool call arguments (keep only tool names and outcomes)
- Intermediate reasoning that led to discarded approaches
- Verbose file contents (keep only file paths and change summaries)

Output format: Use structured sections with clear headers. Be concise but comprehensive.
Target: Compress to approximately 10-15% of the original content length.`;

function shouldCompress(history, turn) {
  // Compress if we have more than 15 messages in history and we are at turn 6 or higher
  return history.length > 15 && turn >= 6;
}

function fallbackCompress(history) {
  const recent = history.slice(-10);
  const lines = recent.map(msg => {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'Tool';
    const content = typeof msg.content === 'string'
      ? msg.content.slice(0, 200)
      : '[complex content]';
    return `${role}: ${content}`;
  });
  return `[Fallback Summary - Last ${recent.length} messages]\n${lines.join('\n')}`;
}

async function compressHistory(history, channelsToTry, sendLog) {
  const log = sendLog || ((level, msg) => logger[level](msg));
  log('info', `[历史压缩] 检测到上下文过长 (${history.length} 条消息)，启动大模型智能压缩...`);

  // We keep history[0] (original prompt) and history.slice(-6) (last 3 turns of ReAct history)
  const segmentToCompress = history.slice(1, -6);
  const keepLastTurns = history.slice(-6);

  const textToCompress = segmentToCompress.map(msg => {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'Tool';
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    // Truncate individual messages to avoid overflowing the compressor itself
    const truncated = content.length > 8000
      ? content.slice(0, 8000) + '\n... [truncated]'
      : content;
    return `[${role}]: ${truncated}`;
  }).join('\n\n');

  const messages = [
    { role: 'system', content: COMPRESSION_SYSTEM_PROMPT },
    { role: 'user', content: `Please compress this conversation into a structured summary:\n\n${textToCompress}` }
  ];

  try {
    // Query LLM using the fast model (first channel in list) with stream=false, useTools=false, effort=none
    const response = await callLLM(channelsToTry, messages, false, true, 'none', sendLog);
    const summary = response?.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error('模型返回了空摘要');
    }

    log('success', `[历史压缩] 上下文压缩完成。原始长度: ${textToCompress.length} 字符 | 压缩后: ${summary.length} 字符`);

    // Reconstruct the new history:
    // [0] Original Prompt, [1] Compressed Summary, [2...] Last 3 turns
    return [
      history[0],
      { role: 'user', content: `【历史上下文快照（自动压缩汇总）】\n${summary}` },
      ...keepLastTurns
    ];

  } catch (error) {
    log('error', `[历史压缩] 压缩失败: ${error.message}，启动 fallback 截断压缩。`);
    const summary = fallbackCompress(history);
    return [
      history[0],
      { role: 'user', content: `【历史上下文快照（截断快照）】\n${summary}` },
      ...keepLastTurns
    ];
  }
}

module.exports = {
  shouldCompress,
  compressHistory
};
