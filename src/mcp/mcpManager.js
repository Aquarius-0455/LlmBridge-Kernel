const logger = require('../lib/logger');

let activeServers = {}; // serverId -> { client, transport, tools }
let toolToClientMap = new Map(); // toolName -> { client, serverId }
let isInitialized = false;

async function initialize(config) {
  if (isInitialized) {
    await shutdownAll();
  }

  if (!config.mcpEnabled || !config.mcpServers) {
    logger.info("MCP is disabled globally. Skipping initialization.");
    isInitialized = true;
    return;
  }

  // Dynamically import MCP SDK modules
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');

  for (const [id, server] of Object.entries(config.mcpServers)) {
    if (!server.enabled) continue;

    logger.info(`Initializing MCP Server [${id}] (Type: ${server.type})...`);
    try {
      let transport;
      if (server.type === 'stdio') {
        const env = { ...process.env, ...(server.env || {}) };
        transport = new StdioClientTransport({
          command: server.command,
          args: server.args || [],
          env
        });
      } else if (server.type === 'sse') {
        transport = new SSEClientTransport(new URL(server.url));
      } else {
        logger.warn(`Unknown MCP transport type [${server.type}] for server [${id}]. Skipping.`);
        continue;
      }

      const client = new Client({
        name: `ag-demo-client-${id}`,
        version: '1.0.0'
      });

      await client.connect(transport);
      const result = await client.listTools();
      const toolsCount = result.tools ? result.tools.length : 0;
      logger.info(`🟢 MCP Server [${id}] connected successfully. Discovered ${toolsCount} tools.`);

      // Store in active servers
      activeServers[id] = { client, transport, tools: result.tools || [] };

      // Map tools for routing
      if (result.tools) {
        for (const tool of result.tools) {
          toolToClientMap.set(tool.name, { client, serverId: id });
        }
      }
    } catch (e) {
      logger.error(`🔴 Failed to initialize MCP Server [${id}]: ${e.message}`);
    }
  }

  isInitialized = true;
}

async function shutdownAll() {
  logger.info("Shutting down all active MCP servers...");
  for (const [id, server] of Object.entries(activeServers)) {
    try {
      await server.client.close();
      logger.info(`Stopped MCP Server [${id}]`);
    } catch (e) {
      logger.error(`Error stopping MCP Server [${id}]: ${e.message}`);
    }
  }
  activeServers = {};
  toolToClientMap.clear();
  isInitialized = false;
}

function getMcpTools() {
  const tools = [];
  for (const [serverId, serverInfo] of Object.entries(activeServers)) {
    for (const tool of serverInfo.tools) {
      // Exclude conflict with native tools
      const nativeTools = ['read_file', 'list_dir', 'get_current_time', 'write_file', 'create_dir', 'delete_file', 'run_command'];
      if (nativeTools.includes(tool.name)) {
        logger.warn(`MCP tool [${tool.name}] from server [${serverId}] conflicts with a native tool. Skipping.`);
        continue;
      }
      tools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
      });
    }
  }
  return tools;
}

function isMcpTool(name) {
  return toolToClientMap.has(name);
}

async function callMcpTool(name, args) {
  const mapping = toolToClientMap.get(name);
  if (!mapping) {
    throw new Error(`MCP tool [${name}] not found or server offline.`);
  }
  
  logger.info(`Forwarding call to MCP Server [${mapping.serverId}] -> Tool: ${name}`);
  const response = await mapping.client.callTool({
    name,
    arguments: args
  });

  // Extract content
  if (response && response.content) {
    return response.content.map(part => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return `[Image Data: ${part.mimeType}]`;
      return JSON.stringify(part);
    }).join('\n');
  }
  
  return JSON.stringify(response);
}

module.exports = {
  initialize,
  shutdownAll,
  getMcpTools,
  isMcpTool,
  callMcpTool
};
