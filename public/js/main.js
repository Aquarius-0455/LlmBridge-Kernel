import { fetchConfig, saveConfigToServer, fetchAgentMode, saveAgentModeToServer, checkServerHealth } from './api.js';
import { appConfig, setAppConfig, setConversationHistory } from './state.js';
import { renderUI } from './ui/channels.js';
import { initMcpUI } from './ui/mcp.js';
import { sendMessage, renderMessages, appendConsoleLog, updateServerStatus, setAgentModeUI } from './ui/chat.js';
import { initCustomSelect } from './features/customSelect.js';
import { initFileUpload } from './features/fileUpload.js';
import { openModal, closeModal } from './ui/modal.js';
import { HEALTH_POLL_INTERVAL } from './constants.js';

const chatInputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const clearConsoleBtn = document.getElementById('clear-console-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const addChannelBtn = document.getElementById('add-channel-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const agentModeToggle = document.getElementById('agent-mode-toggle');
const agentMaxTurnsInput = document.getElementById('agent-max-turns');
const modalCancelBtn = document.getElementById('modal-cancel');
const systemPromptInput = document.getElementById('system-prompt-input');

async function initApp() {
  // 1. Fetch config from server
  try {
    const config = await fetchConfig();
    setAppConfig(config);
    updateServerStatus(true);
    renderUI();
    initMcpUI();
    // 将 systemPrompt 填入界面
    if (systemPromptInput) {
      systemPromptInput.value = config.systemPrompt || '';
    }
  } catch (err) {
    console.error("加载配置失败:", err);
    updateServerStatus(false);
  }

  // 2. Fetch agent mode status from server
  try {
    const amData = await fetchAgentMode();
    agentModeToggle.checked = amData.agentMode;
    agentMaxTurnsInput.value = amData.agentMaxTurns || 10;
    if (appConfig) {
      appConfig.agentMode = amData.agentMode;
      appConfig.agentMaxTurns = amData.agentMaxTurns || 10;
    }
    setAgentModeUI(amData.agentMode, amData.agentMaxTurns || 10);
  } catch (_) {}

  // 3. Bind event listeners
  agentModeToggle.addEventListener('change', async () => {
    const enabled = agentModeToggle.checked;
    const turns = parseInt(agentMaxTurnsInput.value) || 10;
    try {
      await saveAgentModeToServer(enabled, turns);
      if (appConfig) {
        appConfig.agentMode = enabled;
        appConfig.agentMaxTurns = turns;
      }
      setAgentModeUI(enabled, turns);
      appendConsoleLog(enabled ? 'success' : 'info',
        enabled ? `动脑模式已开启（最大 ${turns} 轮）` : '已关闭动脑模式');
    } catch (e) {
      appendConsoleLog('error', '动脑模式切换失败: ' + e.message);
      agentModeToggle.checked = !enabled; // rollback
    }
  });

  agentMaxTurnsInput.addEventListener('change', async () => {
    let turns = parseInt(agentMaxTurnsInput.value);
    if (isNaN(turns) || turns < 1) turns = 1;
    agentMaxTurnsInput.value = turns;
    try {
      await saveAgentModeToServer(agentModeToggle.checked, turns);
      if (appConfig) {
        appConfig.agentMaxTurns = turns;
      }
      setAgentModeUI(agentModeToggle.checked, turns);
      appendConsoleLog('success', `最大思考轮数已更新为 ${turns} 轮`);
    } catch (e) {
      appendConsoleLog('error', '轮数保存失败: ' + e.message);
    }
  });

  // Bind save config (include latest systemPrompt from textarea)
  saveConfigBtn.addEventListener('click', async () => {
    if (systemPromptInput) {
      appConfig.systemPrompt = systemPromptInput.value;
    }
    try {
      await saveConfigToServer(appConfig);
      appendConsoleLog('success', '已将最新的模型路由、通道与系统提示词配置成功写入 config.json！');
      const { showToast } = await import('./ui/toast.js');
      showToast('配置保存成功！', 'success');
    } catch (err) {
      appendConsoleLog('error', `写入配置失败: ${err.message}`);
    }
  });

  // Initialize theme from localStorage
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    if (themeToggleBtn) {
      themeToggleBtn.innerHTML = '<span class="theme-icon">☀️</span> 亮色模式';
    }
  }

  // Bind theme toggle
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggleBtn.innerHTML = isDark 
        ? '<span class="theme-icon">☀️</span> 亮色模式'
        : '<span class="theme-icon">🌙</span> 暗色模式';
    });
  }

  sendBtn.addEventListener('click', sendMessage);
  chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Bind clear chats/logs
  clearChatBtn.addEventListener('click', () => {
    setConversationHistory([]);
    renderMessages();
    appendConsoleLog('info', '已清空本地对话历史。');
  });

  clearConsoleBtn.addEventListener('click', () => {
    document.getElementById('console-logs').innerHTML = '';
    appendConsoleLog('info', '控制台日志已清空。');
  });

  // Bind modal triggers
  addChannelBtn.addEventListener('click', () => openModal(null));
  modalCancelBtn.addEventListener('click', closeModal);

  // Initialize features
  initCustomSelect();
  initFileUpload();
  renderMessages();

  // 4. Poll server health dynamically
  setInterval(async () => {
    try {
      const data = await checkServerHealth();
      updateServerStatus(data.ok);
    } catch (e) {
      updateServerStatus(false);
    }
  }, HEALTH_POLL_INTERVAL);
}

// Start application
initApp();
