export async function fetchConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Failed to fetch config');
  return response.json();
}

export async function saveConfigToServer(appConfig) {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appConfig)
  });
  if (!response.ok) throw new Error('Failed to save config');
  return response.json();
}

export async function fetchAgentMode() {
  const response = await fetch('/api/agent-mode');
  if (!response.ok) throw new Error('Failed to fetch agent mode');
  return response.json();
}

export async function saveAgentModeToServer(agentMode, agentMaxTurns) {
  const response = await fetch('/api/agent-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentMode, agentMaxTurns })
  });
  if (!response.ok) throw new Error('Failed to save agent mode');
  return response.json();
}

export async function checkServerHealth() {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error('Health check failed');
  return response.json();
}

export async function sendConfirmResponse(requestId, approved) {
  const response = await fetch('/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, approved })
  });
  if (!response.ok) throw new Error('Failed to send confirm response');
  return response.json();
}

export async function sendChatRequest(messages, useFastModel, effort) {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, useFastModel, effort })
  });
}
