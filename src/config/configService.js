const fs = require('fs');
const { CONFIG_FILE, DEFAULT_CONFIG } = require('./constants');
const logger = require('../lib/logger');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...config };
    }
  } catch (e) {
    logger.error("Error reading config.json, using defaults", e);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    logger.error("Error writing config.json", e);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG
};
