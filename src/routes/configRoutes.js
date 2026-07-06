const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../config/configService');
const mcpManager = require('../mcp/mcpManager');

router.get('/config', (req, res) => {
  res.json(loadConfig());
});

router.post('/config', async (req, res) => {
  const newConfig = req.body;
  console.log("Received config save request:", JSON.stringify(newConfig, null, 2));
  if (!newConfig.channels || !newConfig.fallbackChain) {
    return res.status(400).json({ error: "Invalid configuration structure" });
  }
  saveConfig(newConfig);
  
  // 在后台异步重载 MCP 服务，不阻塞 HTTP 响应，从而让前端保存“秒开”
  mcpManager.initialize(newConfig).catch(err => {
    console.error("Failed to reload MCP in background:", err);
  });

  res.json({ success: true, config: newConfig });
});

module.exports = router;
