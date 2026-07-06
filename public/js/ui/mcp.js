import { appConfig, editingMcpId, setEditingMcpId } from '../state.js';
import { saveConfigToServer } from '../api.js';
import { showConfirm } from './confirm.js';
import { showToast } from './toast.js';
import { appendConsoleLog } from './chat.js';

const mcpEnabledToggle = document.getElementById('mcp-enabled-toggle');
const mcpServersContainer = document.getElementById('mcp-servers-container');
const mcpListEl = document.getElementById('mcp-list');
const addMcpBtn = document.getElementById('add-mcp-btn');

// Modal Elements
const mcpModal = document.getElementById('mcp-modal');
const mcpModalTitle = document.getElementById('mcp-modal-title');
const mcpTemplateSelect = document.getElementById('mcp-template-select');
const mcpIdInput = document.getElementById('mcp-id');
const mcpNameInput = document.getElementById('mcp-name');
const mcpCommandInput = document.getElementById('mcp-command');
const mcpArgsInput = document.getElementById('mcp-args');
const mcpEnvInput = document.getElementById('mcp-env');
const mcpUrlInput = document.getElementById('mcp-url');
const mcpStdioFields = document.getElementById('mcp-stdio-fields');
const mcpSseFields = document.getElementById('mcp-sse-fields');
const mcpModalCancelBtn = document.getElementById('mcp-modal-cancel');
const mcpModalSaveBtn = document.getElementById('mcp-modal-save');

export function initMcpUI() {
  if (!mcpEnabledToggle) return;

  // Bind global toggle
  mcpEnabledToggle.addEventListener('change', async () => {
    const enabled = mcpEnabledToggle.checked;
    appConfig.mcpEnabled = enabled;
    mcpServersContainer.style.display = enabled ? 'block' : 'none';
    appendConsoleLog('info', enabled ? '已开启 MCP 扩展工具支持。' : '已关闭 MCP 扩展工具支持。');
    await saveConfig();
  });

  // Bind template select change
  mcpTemplateSelect.addEventListener('change', () => {
    const val = mcpTemplateSelect.value;
    handleTemplateSelect(val);
  });

  // Modal actions
  addMcpBtn.addEventListener('click', () => openMcpModal(null));
  mcpModalCancelBtn.addEventListener('click', closeMcpModal);
  mcpModalSaveBtn.addEventListener('click', saveMcpServer);

  // Initial render
  mcpEnabledToggle.checked = !!appConfig.mcpEnabled;
  mcpServersContainer.style.display = appConfig.mcpEnabled ? 'block' : 'none';
  renderMcpList();
}

function handleTemplateSelect(val) {
  // Hide all fields first
  mcpStdioFields.style.display = 'none';
  mcpSseFields.style.display = 'none';

  if (val === 'custom-sse') {
    mcpSseFields.style.display = 'block';
    mcpIdInput.disabled = false;
    mcpNameInput.value = '';
    mcpUrlInput.value = '';
  } else {
    mcpStdioFields.style.display = 'block';
    mcpIdInput.disabled = false;
    
    if (val === 'fetch') {
      mcpIdInput.value = 'fetch';
      mcpIdInput.disabled = true;
      mcpNameInput.value = 'Web 网页抓取 (Fetch)';
      mcpCommandInput.value = 'npx';
      mcpArgsInput.value = '-y mcp-fetch-server';
      mcpEnvInput.value = '{}';
    } else if (val === 'brave-search') {
      mcpIdInput.value = 'brave-search';
      mcpIdInput.disabled = true;
      mcpNameInput.value = 'Brave 网页搜索';
      mcpCommandInput.value = 'npx';
      mcpArgsInput.value = '-y @brave/brave-search-mcp-server';
      mcpEnvInput.value = '{\n  "BRAVE_API_KEY": ""\n}';
    } else if (val === 'sqlite') {
      mcpIdInput.value = 'sqlite';
      mcpIdInput.disabled = true;
      mcpNameInput.value = 'SQLite 数据库只读浏览器';
      mcpCommandInput.value = 'npx';
      mcpArgsInput.value = '-y @mokei/mcp-sqlite';
      mcpEnvInput.value = '{}';
    } else {
      // Custom stdio
      mcpNameInput.value = '';
      mcpCommandInput.value = '';
      mcpArgsInput.value = '';
      mcpEnvInput.value = '{}';
    }
  }
}

export function renderMcpList() {
  mcpListEl.innerHTML = '';
  if (!appConfig.mcpServers) appConfig.mcpServers = {};

  Object.entries(appConfig.mcpServers).forEach(([id, server]) => {
    const card = document.createElement('div');
    card.className = 'channel-card';
    card.style.padding = '8px 10px';
    
    const statusColor = server.enabled ? '#22c55e' : '#ef4444';
    const statusText = server.enabled ? '已启用' : '已禁用';
    
    card.innerHTML = `
      <div class="channel-info" style="cursor: pointer;">
        <h4 style="font-size: 11px; display: flex; align-items: center; gap: 6px; margin: 0;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${statusColor}; display: inline-block;"></span>
          ${server.name || id}
        </h4>
        <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">
          ${server.type === 'stdio' ? `${server.command} ${server.args ? server.args.slice(0,2).join(' ') : ''}` : server.url}
        </div>
      </div>
      <div class="channel-actions" style="display: flex; gap: 4px;">
        <button class="btn btn-secondary btn-xs enable-toggle-btn" style="padding: 2px 4px; font-size: 9px;">${server.enabled ? '禁用' : '启用'}</button>
        <button class="btn btn-secondary btn-xs edit-btn" style="padding: 2px 4px; font-size: 9px;">编辑</button>
        <button class="btn btn-secondary btn-xs delete-btn" style="color: #ef4444; padding: 2px 4px; font-size: 9px;">删除</button>
      </div>
    `;

    // Bind enable toggle
    card.querySelector('.enable-toggle-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      server.enabled = !server.enabled;
      appendConsoleLog('info', `${server.enabled ? '开启' : '关闭'} MCP 服务 [${id}]`);
      renderMcpList();
      await saveConfig();
    });

    // Bind edit
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openMcpModal(id);
    });

    card.querySelector('.channel-info').addEventListener('click', () => {
      openMcpModal(id);
    });

    // Bind delete
    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirm(`确定要删除 MCP 服务 "${server.name || id}" 吗？`, '确认删除');
      if (confirmed) {
        delete appConfig.mcpServers[id];
        appendConsoleLog('info', `已删除 MCP 服务配置 [${id}]`);
        renderMcpList();
        await saveConfig();
      }
    });

    mcpListEl.appendChild(card);
  });
}

function openMcpModal(id) {
  setEditingMcpId(id);
  mcpModal.classList.add('show');

  if (id) {
    mcpModalTitle.textContent = '编辑 MCP 服务器';
    const server = appConfig.mcpServers[id];
    mcpIdInput.value = id;
    mcpIdInput.disabled = true;
    mcpNameInput.value = server.name || '';
    
    if (server.type === 'sse') {
      mcpTemplateSelect.value = 'custom-sse';
      mcpUrlInput.value = server.url || '';
      handleTemplateSelect('custom-sse');
    } else {
      // Find if it matches standard templates
      if (id === 'fetch' && server.command === 'npx' && server.args.includes('mcp-fetch-server')) {
        mcpTemplateSelect.value = 'fetch';
      } else if (id === 'brave-search' && server.command === 'npx' && server.args.includes('@brave/brave-search-mcp-server')) {
        mcpTemplateSelect.value = 'brave-search';
      } else if (id === 'sqlite' && server.command === 'npx' && server.args.includes('@mokei/mcp-sqlite')) {
        mcpTemplateSelect.value = 'sqlite';
      } else {
        mcpTemplateSelect.value = 'custom-stdio';
      }
      
      mcpCommandInput.value = server.command || '';
      mcpArgsInput.value = server.args ? server.args.join(' ') : '';
      mcpEnvInput.value = server.env ? JSON.stringify(server.env, null, 2) : '{}';
      handleTemplateSelect(mcpTemplateSelect.value);
    }
  } else {
    mcpModalTitle.textContent = '添加 MCP 服务器';
    mcpTemplateSelect.value = 'fetch';
    handleTemplateSelect('fetch');
  }
}

function closeMcpModal() {
  mcpModal.classList.remove('show');
  setEditingMcpId(null);
}

async function saveMcpServer() {
  const template = mcpTemplateSelect.value;
  const id = mcpIdInput.value.trim();
  const name = mcpNameInput.value.trim();

  if (!id || !name) {
    showToast('ID 和显示名称为必填项！', 'error');
    return;
  }

  let serverData = { id, name, enabled: true };

  if (!appConfig.mcpServers) {
    appConfig.mcpServers = {};
  }

  if (template === 'custom-sse') {
    const url = mcpUrlInput.value.trim();
    if (!url) {
      showToast('SSE URL 为必填项！', 'error');
      return;
    }
    serverData.type = 'sse';
    serverData.url = url;
  } else {
    const command = mcpCommandInput.value.trim();
    const argsStr = mcpArgsInput.value.trim();
    const envStr = mcpEnvInput.value.trim();

    if (!command) {
      showToast('Command 为必填项！', 'error');
      return;
    }

    serverData.type = 'stdio';
    serverData.command = command;
    serverData.args = argsStr ? argsStr.split(/\s+/) : [];
    
    try {
      serverData.env = envStr ? JSON.parse(envStr) : {};
    } catch (e) {
      showToast('环境变量格式错误，必须为合法的 JSON！', 'error');
      return;
    }
  }

  if (editingMcpId) {
    serverData.enabled = appConfig.mcpServers[editingMcpId].enabled;
    appConfig.mcpServers[id] = serverData;
    appendConsoleLog('info', `已保存 MCP 服务 [${name}] 的更改。`);
  } else {
    if (appConfig.mcpServers[id]) {
      showToast('该 ID 已经存在，请输入一个唯一的 ID！', 'error');
      return;
    }
    appConfig.mcpServers[id] = serverData;
    appendConsoleLog('info', `已成功添加 MCP 服务 [${name}]。`);
  }

  closeMcpModal();
  renderMcpList();
  await saveConfig();
}

async function saveConfig() {
  try {
    await saveConfigToServer(appConfig);
    showToast('MCP 配置已自动保存并应用！', 'success');
  } catch (e) {
    appendConsoleLog('error', `保存 MCP 配置失败: ${e.message}`);
  }
}
