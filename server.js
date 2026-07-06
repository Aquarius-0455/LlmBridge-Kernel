const express = require('express');
const path = require('path');
const { loadConfig } = require('./src/config/configService');
const mcpManager = require('./src/mcp/mcpManager');

const app = express();
const PORT = 3300;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', require('./src/routes/healthRoutes'));
app.use('/api', require('./src/routes/configRoutes'));
app.use('/api', require('./src/routes/agentModeRoutes'));
app.use('/api', require('./src/routes/chatRoutes'));

// Initialize MCP manager with the current configuration on startup
mcpManager.initialize(loadConfig()).catch(err => {
  console.error("Failed to initialize MCP servers on startup:", err);
});

// Handle graceful shutdown for child processes
const gracefulShutdown = async () => {
  console.log("\nReceived shutdown signal. Stopping child processes...");
  await mcpManager.shutdownAll();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  LlmBridge Streaming Multi-Model Gateway is running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
