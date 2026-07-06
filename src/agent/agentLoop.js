const { callLLM } = require('../llm/llmClient');
const { executeTool } = require('../tools/toolExecutor');
const { shouldCompress, compressHistory } = require('./contextCompressor');
const { pendingApprovals } = require('./approvalRegistry');
const logger = require('../lib/logger');
const nativeTools = require('../tools/toolDefinitions');
const { getMcpTools } = require('../mcp/mcpManager');

async function runAgentLoop({ messages, config, channelsToTry, sendSSE, sendLog }) {
  const MAX_TURNS = config.agentMaxTurns || 10;
  let conversationHistory = [...messages];
  let turn = 0;
  let toolErrorCounts = {};
  let earlyWarningSent = false;
  let finalWarningSent = false;
  let forceFinishSent = false;

  const mcpTools = getMcpTools();
  const combinedTools = [...nativeTools, ...mcpTools];

  sendLog('info', `动脑模式已开启 | 最大轮数: ${MAX_TURNS} | 原生工具: ${nativeTools.length} | MCP 工具: ${mcpTools.length}`);

  // Human-in-the-Loop request approval callback
  const requestApproval = (toolName, args) => {
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2, 9);
      sendLog('warn', `[安全确认] 该操作需要用户许可：${toolName} | 参数: ${JSON.stringify(args)}`);
      
      pendingApprovals.set(requestId, (approved) => {
        sendLog('info', `[安全确认] 用户审批结果: ${approved ? '允许执行' : '拒绝执行'}`);
        resolve(approved);
      });

      sendSSE({
        type: 'confirm_request',
        requestId,
        toolName,
        args
      });
    });
  };

  try {
    while (true) {
      turn++;

      // ── Context Compression Check ────────────────────────
      if (shouldCompress(conversationHistory, turn)) {
        conversationHistory = await compressHistory(conversationHistory, channelsToTry, sendLog);
      }

      // ── 三段式软上限机制 ──────────────────────────
      // 阶段一：剩余 3 轮时发早期警告
      if (!earlyWarningSent && turn >= MAX_TURNS - 3) {
        earlyWarningSent = true;
        sendLog('warn', `[动脑 第${turn}轮] 轮数预警：仅剩约 3 轮，请加速收尾`);
        conversationHistory.push({ role: 'user', content: '【轮数预警】剩余轮次有限，请聚焦核心任务，尽快给出最终答案。' });
      }
      // 阶段二：剩余 1 轮时发最终警告
      if (!finalWarningSent && turn >= MAX_TURNS - 1) {
        finalWarningSent = true;
        sendLog('warn', `[动脑 第${turn}轮] 最终警告：仅剩 1 轮，立即输出结果！`);
        conversationHistory.push({ role: 'user', content: '【最终警告】仅剩最后 1 轮。请立即停止工具调用，直接输出你的最终答案。' });
      }
      // 阶段三：超出上限，强制结束
      if (turn > MAX_TURNS) {
        if (!forceFinishSent) {
          forceFinishSent = true;
          sendLog('warn', `[动脑] 已达最大轮数 ${MAX_TURNS}，强制注入结束指令...`);
          conversationHistory.push({ role: 'user', content: '【系统强制结束】已超出最大执行轮数。请基于已有信息立即给出最终答案，不得再调用任何工具。' });
          const forceResp = await callLLM(channelsToTry, conversationHistory, false, false, 'none', sendLog);
          const forceText = forceResp?.choices?.[0]?.message?.content || '（强制结束，无输出）';
          sendSSE({ type: 'content', text: forceText });
        }
        break;
      }
      // ───────────────────────────────────────────────────────

      sendLog('info', `[动脑 第${turn}/${MAX_TURNS}轮] 思考中...`);
      // Call LLM with combinedTools
      const response = await callLLM(channelsToTry, conversationHistory, combinedTools, false, 'none', sendLog);
      const choice = response?.choices?.[0];
      const finishReason = choice?.finish_reason;
      const assistantMsg = choice?.message;

      if (!assistantMsg) {
        sendLog('error', '[动脑] 模型返回了空消息，终止');
        break;
      }

      // 把模型的回复存入对话历史
      conversationHistory.push(assistantMsg);

      if (finishReason === 'tool_calls' && assistantMsg.tool_calls?.length > 0) {
        // ── 大模型决定调工具 ──────────────────────────────────
        for (const toolCall of assistantMsg.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs = {};
          try { toolArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch (_) {}

          sendLog('info', `[动脑] 🔧 调用工具: ${toolName} | 参数: ${JSON.stringify(toolArgs)}`);

          // Pass requestApproval callback to handle high-risk actions
          const toolResult = await executeTool(toolName, toolArgs, requestApproval);
          const isError = toolResult.startsWith('[Error]');

          // 工具失败计数
          if (isError) {
            toolErrorCounts[toolName] = (toolErrorCounts[toolName] || 0) + 1;
            if (toolErrorCounts[toolName] >= 3) {
              sendLog('warn', `[动脑] 工具 [${toolName}] 连续失败 3 次，注入放弃提示`);
              conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: `[系统提示] 工具 ${toolName} 已多次失败，请换用其他方式完成任务。` });
              continue;
            }
          }

          sendLog(isError ? 'warn' : 'success', `[动脑] 工具结果 (${toolName}): ${String(toolResult).slice(0, 100)}...`);
          conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: String(toolResult) });
        }
        // 工具执行完毕，继续下一轮思考

      } else {
        // ── 大模型给出最终答案 → 推给前端 ────────────────────
        const finalText = assistantMsg.content || '';
        sendLog('success', `[动脑 第${turn}轮] 任务完成，推送最终答案`);
        sendSSE({ type: 'content', text: finalText });
        break;
      }
    }

    sendSSE({ type: 'done', agentMode: true, totalTurns: turn });

  } catch (agentErr) {
    sendLog('error', `[动脑] 致命错误: ${agentErr.message}`);
    sendSSE({ type: 'error', message: agentErr.message });
  }
}

module.exports = {
  runAgentLoop
 };
