const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../config/configService');

router.get('/agent-mode', (req, res) => {
  const config = loadConfig();
  res.json({
    agentMode: config.agentMode || false,
    agentMaxTurns: config.agentMaxTurns || 10
  });
});

router.post('/agent-mode', (req, res) => {
  const config = loadConfig();
  const { agentMode, agentMaxTurns } = req.body;
  config.agentMode = typeof agentMode === 'boolean' ? agentMode : config.agentMode;
  if (agentMaxTurns) {
    config.agentMaxTurns = agentMaxTurns;
  }
  saveConfig(config);
  res.json({
    success: true,
    agentMode: config.agentMode,
    agentMaxTurns: config.agentMaxTurns
  });
});

module.exports = router;
