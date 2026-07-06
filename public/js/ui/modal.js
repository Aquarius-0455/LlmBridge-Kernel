import { appConfig, setEditingChannelId } from '../state.js';
import { eyeCloseSvg, eyeOpenSvg } from '../constants.js';

const channelModal = document.getElementById('channel-modal');
const modalTitle = document.getElementById('modal-title');
const channelIdInput = document.getElementById('channel-id');
const channelNameInput = document.getElementById('channel-name');
const channelUrlInput = document.getElementById('channel-url');
const channelKeyInput = document.getElementById('channel-key');
const channelModelInput = document.getElementById('channel-model');
const channelFastModelInput = document.getElementById('channel-fast-model');
const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');

if (toggleKeyVisibilityBtn) {
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    const isPassword = channelKeyInput.type === 'password';
    channelKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisibilityBtn.innerHTML = isPassword ? eyeOpenSvg : eyeCloseSvg;
  });
}

export function openModal(channelId = null) {
  setEditingChannelId(channelId);
  
  channelKeyInput.setAttribute('type', 'password');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  if (toggleKeyVisibilityBtn) {
    toggleKeyVisibilityBtn.innerHTML = eyeCloseSvg;
  }
  
  if (channelId) {
    const channel = appConfig.channels.find(c => c.id == channelId);
    modalTitle.innerText = "编辑模型通道配置";
    channelIdInput.value = channel.id;
    channelIdInput.disabled = true;
    channelNameInput.value = channel.name;
    channelUrlInput.value = channel.baseUrl;
    channelKeyInput.value = channel.apiKey;
    channelModelInput.value = channel.modelName;
    channelFastModelInput.value = channel.fastModelName || "";
  } else {
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

export function closeModal() {
  channelModal.classList.remove('show');
}
