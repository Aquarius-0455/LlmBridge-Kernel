// State Management
let appConfig = {
  channels: [],
  fallbackChain: []
};

let conversationHistory = [];
let editingChannelId = null; // null for add, string for edit

// SVG Eye Icons for Password toggle
const eyeOpenSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const eyeCloseSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

let currentAttachment = null; // Stores current file attachments { name, type, content, isImage }

// DOM Elements
const channelsListEl = document.getElementById('channels-list');
const fallbackChainListEl = document.getElementById('fallback-chain-list');
const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const consoleLogsEl = document.getElementById('console-logs');
const clearConsoleBtn = document.getElementById('clear-console-btn');
const addChannelBtn = document.getElementById('add-channel-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const useFastModelToggle = document.getElementById('use-fast-model-toggle');
const chatEffortSelect = document.getElementById('chat-effort-select');
const agentModeToggle = document.getElementById('agent-mode-toggle');
const agentTurnsRow = document.getElementById('agent-turns-row');
const agentMaxTurnsInput = document.getElementById('agent-max-turns');
const agentTurnsBadge = document.getElementById('agent-turns-badge');

// Modal Elements
const channelModal = document.getElementById('channel-modal');
const modalTitle = document.getElementById('modal-title');
const channelIdInput = document.getElementById('channel-id');
const channelNameInput = document.getElementById('channel-name');
const channelUrlInput = document.getElementById('channel-url');
const channelKeyInput = document.getElementById('channel-key');
const channelModelInput = document.getElementById('channel-model');
const channelFastModelInput = document.getElementById('channel-fast-model');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalSaveBtn = document.getElementById('modal-save');

// Write to visual log console
function appendConsoleLog(level, message, timestamp) {
  const line = document.createElement('div');
  const time = timestamp || new Date().toLocaleTimeString();
  line.className = `log-line text-${level}`;
  line.innerText = `[${time}] [${level.toUpperCase()}] ${message}`;
  consoleLogsEl.appendChild(line);
  consoleLogsEl.scrollTop = consoleLogsEl.scrollHeight;
}

// Update visual server connection health status
function updateServerStatus(isActive) {
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

// Fetch current configuration on startup
async function initApp() {
  try {
    const response = await fetch('/api/config');
    appConfig = await response.json();
    updateServerStatus(true);
    renderUI();
  } catch (err) {
    console.error("加载配置失败:", err);
    updateServerStatus(false);
  }

  // Sync Agent Mode state from server
  try {
    const amResp = await fetch('/api/agent-mode');
    const amData = await amResp.json();
    agentModeToggle.checked = amData.agentMode;
    agentMaxTurnsInput.value = amData.agentMaxTurns || 10;
    setAgentModeUI(amData.agentMode, amData.agentMaxTurns || 10);
  } catch (_) {}

  // Agent Mode toggle event
  agentModeToggle.addEventListener('change', async () => {
    const enabled = agentModeToggle.checked;
    const turns = parseInt(agentMaxTurnsInput.value) || 10;
    try {
      await fetch('/api/agent-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentMode: enabled, agentMaxTurns: turns })
      });
      setAgentModeUI(enabled, turns);
      appendConsoleLog(enabled ? 'success' : 'info',
        enabled ? `动脑模式已开启（最大 ${turns} 轮）` : '已关闭动脑模式');
    } catch (e) {
      appendConsoleLog('error', '动脑模式切换失败: ' + e.message);
      agentModeToggle.checked = !enabled; // rollback
    }
  });

  // Auto-save max turns on input change
  agentMaxTurnsInput.addEventListener('change', async () => {
    let turns = parseInt(agentMaxTurnsInput.value);
    if (isNaN(turns) || turns < 1) turns = 1;
    agentMaxTurnsInput.value = turns;
    try {
      await fetch('/api/agent-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentMaxTurns: turns })
      });
      setAgentModeUI(agentModeToggle.checked, turns);
      appendConsoleLog('success', `最大思考轮数已更新为 ${turns} 轮`);
    } catch (e) {
      appendConsoleLog('error', '轮数保存失败: ' + e.message);
    }
  });

  // Initialize beautiful custom select bindings
  initCustomSelect();
  // Initialize dynamic multi-modal attachment upload bindings
  initFileUpload();

  // Poll server health every 5 seconds dynamically
  setInterval(async () => {
    try {
      const response = await fetch('/api/config');
      updateServerStatus(response.ok);
    } catch (e) {
      updateServerStatus(false);
    }
  }, 5000);
}

// Update Agent Mode UI state (toggle visibility of badge and disable input when ON)
function setAgentModeUI(enabled, turns) {
  agentMaxTurnsInput.disabled = enabled;
  if (enabled) {
    agentTurnsBadge.style.display = 'inline-flex';
    agentTurnsBadge.textContent = `max ${turns}轮`;
  } else {
    agentTurnsBadge.style.display = 'none';
  }
}

// Initialize Custom Select Dropdown UI
function initCustomSelect() {
  const customSelect = document.querySelector('.custom-select');
  if (!customSelect) return;
  
  const trigger = customSelect.querySelector('.select-trigger');
  const triggerText = trigger.querySelector('span');
  const optionsContainer = customSelect.querySelector('.select-options');
  const options = optionsContainer.querySelectorAll('.option');
  const nativeSelect = document.getElementById('chat-effort-select');

  // Toggle open dropdown
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    customSelect.classList.toggle('open');
  });

  // Handle option selection
  options.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = opt.getAttribute('data-value');
      const text = opt.innerText;

      // Update active styling
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');

      // Update trigger label
      triggerText.innerText = text;

      // Update native hidden select to fire existing application listeners
      nativeSelect.value = val;
      nativeSelect.dispatchEvent(new Event('change'));

      // Close dropdown
      customSelect.classList.remove('open');
    });
  });

  // Close dropdown on click outside
  document.addEventListener('click', () => {
    customSelect.classList.remove('open');
  });
}

// Render entire UI based on state
function renderUI() {
  renderChannels();
  renderFallbackChain();
}

// 1. Render Channels List
function renderChannels() {
  channelsListEl.innerHTML = '';
  appConfig.channels.forEach(channel => {
    const card = document.createElement('div');
    card.className = 'channel-card';
    
    // Render colored pill tags for models, similar to BETA badge
    const fastModelHtml = channel.fastModelName 
      ? `<span class="model-tag fast-model-tag">${channel.fastModelName}</span>` 
      : '';
      
    card.innerHTML = `
      <div class="channel-info">
        <h4>${channel.name}</h4>
        <div class="channel-meta">
          <span class="model-tag main-model-tag">${channel.modelName}</span>
          ${fastModelHtml}
        </div>
      </div>
      <div class="channel-actions">
        <button class="btn btn-secondary btn-xs edit-btn" data-id="${channel.id}">编辑</button>
        <button class="btn btn-secondary btn-xs delete-btn" style="color: #ef4444;" data-id="${channel.id}">删除</button>
      </div>
    `;
    
    // Bind Edit Action (use loose comparison to avoid string/number mismatch)
    card.querySelector('.edit-btn').addEventListener('click', () => openModal(channel.id));
    
    // Bind Delete Action
    card.querySelector('.delete-btn').addEventListener('click', async () => {
      const confirmed = await showConfirm(`确定要删除通道 "${channel.name}" 吗？`);
      if (confirmed) {
        deleteChannel(channel.id);
      }
    });

    channelsListEl.appendChild(card);
  });
}



// 3. Render Fallback Chain priority list
function renderFallbackChain() {
  fallbackChainListEl.innerHTML = '';
  
  // Filter fallback list to keep only channels that actually exist (loose equality)
  appConfig.fallbackChain = appConfig.fallbackChain.filter(id => appConfig.channels.some(c => c.id == id));
  
  // If any channel is missing in fallbackChain, append it
  appConfig.channels.forEach(ch => {
    if (!appConfig.fallbackChain.some(fid => fid == ch.id)) {
      appConfig.fallbackChain.push(ch.id);
    }
  });

  appConfig.fallbackChain.forEach((id, index) => {
    const channel = appConfig.channels.find(c => c.id == id);
    if (!channel) return;

    const item = document.createElement('div');
    item.className = 'fallback-item';
    item.innerHTML = `
      <div class="fallback-left">
        <div class="fallback-index-badge">${index + 1}</div>
        <div class="fallback-name">${channel.name} <span class="fallback-model-tag">(${channel.modelName})</span></div>
      </div>
      <div class="fallback-ctrls">
        <button class="btn-order move-up" ${index === 0 ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
        </button>
        <button class="btn-order move-down" ${index === appConfig.fallbackChain.length - 1 ? 'disabled' : ''}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
      </div>
    `;

    // Move Up
    item.querySelector('.move-up').addEventListener('click', () => {
      swapFallbackElements(index, index - 1);
    });

    // Move Down
    item.querySelector('.move-down').addEventListener('click', () => {
      swapFallbackElements(index, index + 1);
    });

    fallbackChainListEl.appendChild(item);
  });
}

function swapFallbackElements(idx1, idx2) {
  const temp = appConfig.fallbackChain[idx1];
  appConfig.fallbackChain[idx1] = appConfig.fallbackChain[idx2];
  appConfig.fallbackChain[idx2] = temp;
  appendConsoleLog('info', `调整降级链优先级: [${appConfig.fallbackChain.join(' ➔ ')}]`);
  renderFallbackChain();
}

// Channel Add/Delete Ops
function deleteChannel(id) {
  appConfig.channels = appConfig.channels.filter(c => c.id !== id);
  appConfig.fallbackChain = appConfig.fallbackChain.filter(fid => fid !== id);

  appendConsoleLog('info', `已移除通道: ${id}`);
  renderUI();
}

// Modal handling
function openModal(channelId = null) {
  editingChannelId = channelId;
  
  // Always reset visibility state to hidden on modal open
  channelKeyInput.setAttribute('type', 'password');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  if (toggleKeyVisibilityBtn) {
    toggleKeyVisibilityBtn.innerHTML = eyeCloseSvg;
  }
  
  if (channelId) {
    // Edit Mode
    const channel = appConfig.channels.find(c => c.id == channelId);
    modalTitle.innerText = "编辑模型通道配置";
    channelIdInput.value = channel.id;
    channelIdInput.disabled = true; // Cannot edit ID key
    channelNameInput.value = channel.name;
    channelUrlInput.value = channel.baseUrl;
    channelKeyInput.value = channel.apiKey;
    channelModelInput.value = channel.modelName;
    channelFastModelInput.value = channel.fastModelName || "";
  } else {
    // Add Mode
    modalTitle.innerText = "新建模型通道";
    channelIdInput.value = "";
    channelIdInput.disabled = false;
    channelNameInput.value = "";
    channelUrlInput.value = "";
    channelKeyInput.value = "";
    channelModelInput.value = "";
    channelFastModelInput.value = "";
  }
  channelModal.classList.add('show');
}

// Close Modal
function closeModal() {
  channelModal.classList.remove('show');
}

// Save in Modal
modalSaveBtn.addEventListener('click', () => {
  const id = channelIdInput.value.trim();
  const name = channelNameInput.value.trim();
  const baseUrl = channelUrlInput.value.trim();
  const apiKey = channelKeyInput.value.trim();
  const modelName = channelModelInput.value.trim();
  const fastModelName = channelFastModelInput.value.trim();

  if (!id || !name || !baseUrl || !modelName) {
    showToast("除 API Key 和快速模型外，其他字段均为必填项！", "error");
    return;
  }

  if (editingChannelId) {
    // Save Edit (loose comparison to handle ID type conversions)
    const index = appConfig.channels.findIndex(c => c.id == editingChannelId);
    appConfig.channels[index] = { id, name, baseUrl, apiKey, modelName, fastModelName };
    appendConsoleLog('info', `更新通道配置: ${name} (${id})`);
  } else {
    // Save New
    if (appConfig.channels.some(c => c.id === id)) {
      showToast("ID 已存在，请输入唯一的 ID 标识。", "error");
      return;
    }
    appConfig.channels.push({ id, name, baseUrl, apiKey, modelName, fastModelName });
    appConfig.fallbackChain.push(id);
    appendConsoleLog('info', `成功创建新通道: ${name} (${id})`);
  }

  closeModal();
  renderUI();
});

// Modal cancel buttons
modalCancelBtn.addEventListener('click', closeModal);
addChannelBtn.addEventListener('click', () => openModal(null));

// Toggle API Key visibility
const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
if (toggleKeyVisibilityBtn) {
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    const type = channelKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
    channelKeyInput.setAttribute('type', type);
    toggleKeyVisibilityBtn.innerHTML = type === 'password' ? eyeCloseSvg : eyeOpenSvg;
  });
}

// Save config to disk (Backend Server)
saveConfigBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appConfig)
    });
    const resData = await response.json();
    if (resData.success) {
      appendConsoleLog('success', '已将最新的模型路由与通道配置成功写入 config.json！');
      showToast("配置保存成功！", "success");
    }
  } catch (err) {
    appendConsoleLog('error', `写入配置失败: ${err.message}`);
    alert("保存配置发生错误，详情请看控制台日志。");
  }
});

// Chat Dialog handling
sendBtn.addEventListener('click', sendMessage);
chatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const text = chatInputEl.value.trim();
  // We allow sending if there is text or an attachment
  if (!text && !currentAttachment) return;

  chatInputEl.value = '';
  
  // Construct user message (supports OpenAI vision schema if it is an image attachment)
  let messageContent = text;
  let displayContent = text; // Content shown on frontend UI
  
  if (currentAttachment) {
    if (currentAttachment.isImage) {
      // Vision model payload format
      messageContent = [
        { type: "text", text: text || "请分析这张图片。" },
        { 
          type: "image_url", 
          image_url: { url: currentAttachment.content } 
        }
      ];
      // Display HTML with preview thumbnail
      displayContent = `${text ? text + '\n\n' : ''}[图片附件: ${currentAttachment.name}]\n<img src="${currentAttachment.content}" class="chat-attached-image-preview" style="max-width: 150px; border-radius: 8px; margin-top: 6px; display: block; border: 1px solid var(--border-color);" />`;
    } else {
      // Text attachment: Embed as markdown block code
      messageContent = `[已附加文本文件: ${currentAttachment.name}]\n\`\`\`${currentAttachment.type.split('/')[1] || 'txt'}\n${currentAttachment.content}\n\`\`\`\n\n${text}`;
      displayContent = `[文本附件: ${currentAttachment.name}]\n${text ? '\n' + text : ''}`;
    }
  }

  // Clear current attachment pill
  currentAttachment = null;
  const badgeContainer = document.getElementById('attachment-badge-container');
  if (badgeContainer) badgeContainer.innerHTML = '';
  
  // Append User message
  conversationHistory.push({ role: 'user', content: messageContent, display: displayContent });
  renderMessages();

  // Create real-time loading/reply bubble for streaming output
  const replyBubble = document.createElement('div');
  replyBubble.className = 'chat-bubble assistant';
  replyBubble.innerText = '📡 正在启动智能体网关路由...';
  chatMessagesEl.appendChild(replyBubble);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  let fullAnswerText = '';
  let fullThinkingText = '';
  let usageInfo = null;

  const useFastModel = useFastModelToggle.checked;
  const effort = chatEffortSelect.value;

  // Clean historical messages array for api transmission (remove raw HTML "display" key)
  const apiMessages = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        useFastModel: useFastModel,
        effort: effort
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Process Server-Sent Events stream chunk by chunk
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let chunkBuffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      chunkBuffer += decoder.decode(value, { stream: true });
      const lines = chunkBuffer.split('\n\n');
      chunkBuffer = lines.pop(); // Keep partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            
            if (data.type === 'log') {
              // Append routing log to console in real-time
              appendConsoleLog(data.level, data.message, data.timestamp);
            } else if (data.type === 'thinking') {
              // Clear loader text on first chunk of thinking
              if (replyBubble.innerText.startsWith('📡')) {
                replyBubble.innerHTML = '<div class="thinking-area">思考过程：<span class="thinking-content"></span></div><div class="answer-area"></div>';
              } else if (!replyBubble.querySelector('.thinking-area')) {
                replyBubble.innerHTML = '<div class="thinking-area">思考过程：<span class="thinking-content"></span></div>' + replyBubble.innerHTML;
              }
              const thinkingEl = replyBubble.querySelector('.thinking-content');
              fullThinkingText += data.text;
              thinkingEl.innerText = fullThinkingText;
              chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
            } else if (data.type === 'content') {
              // Clear loader text on first chunk of content
              if (replyBubble.innerText.startsWith('📡')) {
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
              appendConsoleLog('success', `流式响应结束，通道: ${data.channelName}`);
              if (usageInfo) {
                const footer = document.createElement('div');
                footer.className = 'usage-info';
                footer.innerHTML = `<span>Prompt Tokens: ${usageInfo.prompt_tokens}</span><span>Completion Tokens: ${usageInfo.completion_tokens}</span><span>Total Tokens: ${usageInfo.total_tokens}</span>`;
                replyBubble.appendChild(footer);
              }
            } else if (data.type === 'error') {
              appendConsoleLog('error', `路由处理错误: ${data.message}`);
              replyBubble.innerText = `请求错误: ${data.message}`;
            }
          } catch (e) {
            // Json parse error
          }
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

function renderMessages() {
  chatMessagesEl.innerHTML = '';

  // Only render welcome message if there is no conversation history
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

// Tooling actions
clearChatBtn.addEventListener('click', () => {
  conversationHistory = [];
  renderMessages();
  appendConsoleLog('info', '已清空本地对话历史。');
});

clearConsoleBtn.addEventListener('click', () => {
  consoleLogsEl.innerHTML = '';
  appendConsoleLog('info', '控制台日志已清空。');
});

// App Start
initApp();

// Custom Toast notification implementation
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Clean vector SVG icons (Success, Error, Info)
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #22c55e; flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444; flex-shrink:0;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #3b82f6; flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  toast.innerHTML = `${iconSvg}<span>${message}</span>`;
  container.appendChild(toast);

  // Trigger reflow to let CSS transition trigger
  toast.offsetHeight;
  toast.classList.add('show');

  // Dismiss automatically after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, 3000);
}

// Bind custom file upload interactions
function initFileUpload() {
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const badgeContainer = document.getElementById('attachment-badge-container');
  
  if (!uploadBtn || !fileInput) return;

  // Clicking clip icon triggers system file selector
  uploadBtn.addEventListener('click', () => fileInput.click());

  // Handle selected file
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size limit: 5MB
    if (file.size > 5 * 1024 * 1024) {
      showToast("文件大小超出限制 (最大 5MB)", "error");
      fileInput.value = '';
      return;
    }

    const isImage = file.type.startsWith('image/');

    if (isImage) {
      // Auto-downscale large images to safe max 2048px bounding box
      resizeImageIfNeeded(file, 2048).then(attachment => {
        currentAttachment = attachment;
        renderBadge();
      });
    } else {
      // Process standard text file
      const reader = new FileReader();
      reader.onload = function(event) {
        currentAttachment = {
          name: file.name,
          type: file.type,
          isImage: false,
          content: event.target.result
        };
        renderBadge();
      };
      reader.readAsText(file);
    }

    function renderBadge() {
      // Show attachment badge in input card
      badgeContainer.innerHTML = `
        <div class="attachment-badge">
          <span>${file.name}</span>
          <button class="btn-remove-attachment" title="取消文件附件">×</button>
        </div>
      `;

      // Bind remove badge action
      badgeContainer.querySelector('.btn-remove-attachment').addEventListener('click', () => {
        currentAttachment = null;
        badgeContainer.innerHTML = '';
        fileInput.value = ''; // Reset file input
      });
    }
  });
}

// Automatically downscales image dimensions using Canvas if it exceeds maxDim (e.g. 2048px)
function resizeImageIfNeeded(file, maxDim = 2048) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let width = img.width;
        let height = img.height;

        // If already within limits, bypass resizing
        if (width <= maxDim && height <= maxDim) {
          resolve({
            name: file.name,
            type: file.type,
            isImage: true,
            content: e.target.result
          });
          return;
        }

        // Calculate target scale maintaining aspect ratio
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        // Draw image onto canvas at smaller dimensions
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG with 0.85 visual quality to save tokens/bandwidth
        const dataURL = canvas.toDataURL(file.type || 'image/jpeg', 0.85);
        resolve({
          name: file.name,
          type: file.type || 'image/jpeg',
          isImage: true,
          content: dataURL
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Custom Promise-based Confirm dialog modal
function showConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    if (!modal || !msgEl || !okBtn || !cancelBtn) {
      // Fallback in case of missing DOM elements
      resolve(window.confirm(message));
      return;
    }

    msgEl.innerText = message;
    modal.classList.add('show');

    function cleanup() {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }

    function onOk() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}
