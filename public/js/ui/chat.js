import { appConfig, conversationHistory, currentAttachment, setCurrentAttachment } from '../state.js';
import { sendChatRequest, sendConfirmResponse } from '../api.js';
import { showConfirm } from './confirm.js';
import { showToast } from './toast.js';

const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl = document.getElementById('chat-input');
const consoleLogsEl = document.getElementById('console-logs');
const useFastModelToggle = document.getElementById('use-fast-model-toggle');
const chatEffortSelect = document.getElementById('chat-effort-select');
const agentMaxTurnsInput = document.getElementById('agent-max-turns');
const agentTurnsBadge = document.getElementById('agent-turns-badge');

export function appendConsoleLog(level, message, timestamp) {
  const line = document.createElement('div');
  const time = timestamp || new Date().toLocaleTimeString();
  line.className = `log-line text-${level}`;
  line.innerText = `[${time}] [${level.toUpperCase()}] ${message}`;
  consoleLogsEl.appendChild(line);
  consoleLogsEl.scrollTop = consoleLogsEl.scrollHeight;
}

export function updateServerStatus(isActive) {
  const profileStatus = document.querySelector('.profile-status');
  const profileStatusText = document.querySelector('.profile-status span:last-child');
  
  if (isActive) {
    if (profileStatus) profileStatus.classList.remove('offline');
    if (profileStatusText) profileStatusText.innerText = 'Active';
  } else {
    if (profileStatus) profileStatus.classList.add('offline');
    if (profileStatusText) profileStatusText.innerText = 'Offline';
  }
}

export function setAgentModeUI(enabled, turns) {
  agentMaxTurnsInput.disabled = !enabled;
  const nativeToolsInfo = document.getElementById('native-tools-info');
  if (enabled) {
    agentTurnsBadge.style.display = 'inline-flex';
    agentTurnsBadge.textContent = `max ${turns}轮`;
    if (nativeToolsInfo) nativeToolsInfo.style.display = 'flex';
  } else {
    agentTurnsBadge.style.display = 'none';
    if (nativeToolsInfo) nativeToolsInfo.style.display = 'none';
  }
}

export function renderMessages() {
  chatMessagesEl.innerHTML = '';

  if (conversationHistory.length === 0) {
    const systemMsg = document.createElement('div');
    systemMsg.className = 'system-message';
    systemMsg.innerText = '欢迎使用 LlmBridge 多模型流式对话桥接测试面板！请确保已在左侧配置相应的 API Key 后开始对话。';
    chatMessagesEl.appendChild(systemMsg);
  }

  conversationHistory.forEach(msg => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role}`;
    if (msg.role === 'user' && msg.display) {
      bubble.innerHTML = msg.display.replace(/\n/g, '<br>');
    } else {
      bubble.innerText = msg.content;
    }
    chatMessagesEl.appendChild(bubble);
  });
  
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function buildUserMessage(text) {
  let messageContent = text;
  let displayContent = text;
  
  if (currentAttachment) {
    if (currentAttachment.isImage) {
      messageContent = [
        { type: "text", text: text || "请分析这张图片。" },
        { 
          type: "image_url", 
          image_url: { url: currentAttachment.content } 
        }
      ];
      displayContent = `${text ? text + '\n\n' : ''}[图片附件: ${currentAttachment.name}]\n<img src="${currentAttachment.content}" class="chat-attached-image-preview" style="max-width: 150px; border-radius: 8px; margin-top: 6px; display: block; border: 1px solid var(--border-color);" />`;
    } else {
      messageContent = `[已附加文本文件: ${currentAttachment.name}]\n\`\`\`${currentAttachment.type.split('/')[1] || 'txt'}\n${currentAttachment.content}\n\`\`\`\n\n${text}`;
      displayContent = `[文本附件: ${currentAttachment.name}]\n${text ? '\n' + text : ''}`;
    }
  }

  setCurrentAttachment(null);
  const badgeContainer = document.getElementById('attachment-badge-container');
  if (badgeContainer) badgeContainer.innerHTML = '';

  return { messageContent, displayContent };
}

export async function sendMessage() {
  const text = chatInputEl.value.trim();
  if (!text && !currentAttachment) return;

  chatInputEl.value = '';
  
  const { messageContent, displayContent } = buildUserMessage(text);
  
  conversationHistory.push({ role: 'user', content: messageContent, display: displayContent });
  renderMessages();

  const replyBubble = document.createElement('div');
  replyBubble.className = 'chat-bubble assistant';
  replyBubble.innerHTML = '<span class="loading-pulse">⏳ 正在思考...</span>';
  chatMessagesEl.appendChild(replyBubble);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  let fullAnswerText = '';
  let fullThinkingText = '';
  let usageInfo = null;

  const useFastModel = useFastModelToggle.checked;
  const effort = chatEffortSelect.value;

  const apiMessages = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  try {
    const response = await sendChatRequest(apiMessages, useFastModel, effort);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let chunkBuffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      chunkBuffer += decoder.decode(value, { stream: true });
      const lines = chunkBuffer.split('\n\n');
      chunkBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            
            if (data.type === 'log') {
              appendConsoleLog(data.level, data.message, data.timestamp);
            } else if (data.type === 'thinking') {
              if (replyBubble.innerHTML.includes('loading-pulse')) {
                replyBubble.innerHTML = '<details class="thinking-area"><summary>思考过程</summary><div class="thinking-content"></div></details><div class="answer-area"></div>';
              } else if (!replyBubble.querySelector('.thinking-area')) {
                replyBubble.innerHTML = '<details class="thinking-area"><summary>思考过程</summary><div class="thinking-content"></div></details>' + replyBubble.innerHTML;
              }
              const thinkingEl = replyBubble.querySelector('.thinking-content');
              fullThinkingText += data.text;
              thinkingEl.innerText = fullThinkingText;
              chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
            } else if (data.type === 'content') {
              if (replyBubble.innerHTML.includes('loading-pulse')) {
                replyBubble.innerHTML = '<div class="answer-area"></div>';
              } else if (!replyBubble.querySelector('.answer-area')) {
                replyBubble.innerHTML += '<div class="answer-area"></div>';
              }
              const answerEl = replyBubble.querySelector('.answer-area');
              fullAnswerText += data.text;
              answerEl.innerText = fullAnswerText;
              chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
            } else if (data.type === 'usage') {
              usageInfo = data.usage;
            } else if (data.type === 'done') {
              appendConsoleLog('success', `流式响应结束。`);
              if (usageInfo) {
                const footer = document.createElement('div');
                footer.className = 'usage-info';
                footer.innerHTML = `<span>Prompt Tokens: ${usageInfo.prompt_tokens}</span><span>Completion Tokens: ${usageInfo.completion_tokens}</span><span>Total Tokens: ${usageInfo.total_tokens}</span>`;
                replyBubble.appendChild(footer);
              }
            } else if (data.type === 'confirm_request') {
              // High risk action human-in-the-loop approval
              const toolName = data.toolName;
              const args = data.args;
              const requestId = data.requestId;
              
              showConfirm(`大模型请求执行高危命令，是否批准？\n\n工具: ${toolName}\n参数: ${JSON.stringify(args, null, 2)}`, '安全确认').then(async (approved) => {
                try {
                  await sendConfirmResponse(requestId, approved);
                  appendConsoleLog(approved ? 'success' : 'warn', `已提交审批结果: ${approved ? '批准' : '拒绝'}`);
                } catch (e) {
                  appendConsoleLog('error', `提交审批错误: ${e.message}`);
                }
              });
            } else if (data.type === 'error') {
              appendConsoleLog('error', `路由处理错误: ${data.message}`);
              replyBubble.innerText = `请求错误: ${data.message}`;
            }
          } catch (e) {}
        }
      }
    }

    if (fullAnswerText) {
      conversationHistory.push({ role: 'assistant', content: fullAnswerText });
    }

  } catch (err) {
    replyBubble.innerText = `❌ 通信异常: ${err.message}`;
    appendConsoleLog('error', `网络流式传输发生故障: ${err.message}`);
  }
}
