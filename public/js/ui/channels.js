import { appConfig, editingChannelId } from '../state.js';
import { saveConfigToServer } from '../api.js';
import { showConfirm } from './confirm.js';
import { showToast } from './toast.js';
import { openModal, closeModal } from './modal.js';
import { appendConsoleLog } from './chat.js';

const channelsListEl = document.getElementById('channels-list');
const fallbackChainListEl = document.getElementById('fallback-chain-list');

const channelIdInput = document.getElementById('channel-id');
const channelNameInput = document.getElementById('channel-name');
const channelUrlInput = document.getElementById('channel-url');
const channelKeyInput = document.getElementById('channel-key');
const channelModelInput = document.getElementById('channel-model');
const channelFastModelInput = document.getElementById('channel-fast-model');
const modalSaveBtn = document.getElementById('modal-save');

export function renderUI() {
  renderChannels();
  syncFallbackChainState();
  renderFallbackChain();
}

export function renderChannels() {
  channelsListEl.innerHTML = '';
  appConfig.channels.forEach(channel => {
    const card = document.createElement('div');
    card.className = 'channel-card';
    
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
    
    card.querySelector('.edit-btn').addEventListener('click', () => openModal(channel.id));
    card.querySelector('.delete-btn').addEventListener('click', async () => {
      const confirmed = await showConfirm(`确定要删除通道 "${channel.name}" 吗？`, '确认删除');
      if (confirmed) {
        deleteChannel(channel.id);
      }
    });

    channelsListEl.appendChild(card);
  });
}

export function syncFallbackChainState() {
  // Align fallback list: keep only existing channels
  appConfig.fallbackChain = appConfig.fallbackChain.filter(id => 
    appConfig.channels.some(c => c.id == id)
  );
  
  // Append new channels that are missing in the chain
  appConfig.channels.forEach(ch => {
    if (!appConfig.fallbackChain.some(fid => fid == ch.id)) {
      appConfig.fallbackChain.push(ch.id);
    }
  });
}

export function renderFallbackChain() {
  fallbackChainListEl.innerHTML = '';
  
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

    item.querySelector('.move-up').addEventListener('click', () => {
      swapFallbackElements(index, index - 1);
    });

    item.querySelector('.move-down').addEventListener('click', () => {
      swapFallbackElements(index, index + 1);
    });

    fallbackChainListEl.appendChild(item);
  });
}

async function swapFallbackElements(idx1, idx2) {
  const temp = appConfig.fallbackChain[idx1];
  appConfig.fallbackChain[idx1] = appConfig.fallbackChain[idx2];
  appConfig.fallbackChain[idx2] = temp;
  appendConsoleLog('info', `调整降级链优先级: [${appConfig.fallbackChain.join(' ➔ ')}]`);
  renderFallbackChain();
  try {
    await saveConfigToServer(appConfig);
    appendConsoleLog('success', '配置已自动同步并保存。');
  } catch (err) {
    appendConsoleLog('error', `自动同步配置失败: ${err.message}`);
  }
}

async function deleteChannel(id) {
  appConfig.channels = appConfig.channels.filter(c => c.id !== id);
  appConfig.fallbackChain = appConfig.fallbackChain.filter(fid => fid !== id);

  appendConsoleLog('info', `已移除通道: ${id}`);
  renderUI();
  try {
    await saveConfigToServer(appConfig);
    appendConsoleLog('success', '配置已自动同步并保存。');
  } catch (err) {
    appendConsoleLog('error', `自动同步配置失败: ${err.message}`);
  }
}

// Bind modal save action
modalSaveBtn.addEventListener('click', async () => {
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
    const index = appConfig.channels.findIndex(c => c.id == editingChannelId);
    appConfig.channels[index] = { id, name, baseUrl, apiKey, modelName, fastModelName };
    appendConsoleLog('info', `更新通道配置: ${name} (${id})`);
  } else {
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
  try {
    await saveConfigToServer(appConfig);
    appendConsoleLog('success', '配置已自动同步并保存。');
  } catch (err) {
    appendConsoleLog('error', `自动同步配置失败: ${err.message}`);
  }
});
