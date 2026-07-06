// ES Module exports to avoid polluting the global window object scope
export let appConfig = {
  channels: [],
  fallbackChain: [],
  agentMode: false,
  agentMaxTurns: 10
};

export let conversationHistory = [];
export let currentAttachment = null;
export let editingChannelId = null; // null for add, string for edit
export let editingMcpId = null; // null for add, string for edit

export function setAppConfig(val) {
  appConfig = val;
}

export function setConversationHistory(val) {
  conversationHistory = val;
}

export function setCurrentAttachment(val) {
  currentAttachment = val;
}

export function setEditingChannelId(val) {
  editingChannelId = val;
}

export function setEditingMcpId(val) {
  editingMcpId = val;
}
