function formatTime() {
  return new Date().toLocaleTimeString();
}

const logger = {
  info: (msg) => {
    // Show info logs in development or when NODE_ENV is not set
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${formatTime()}] [INFO] ${msg}`);
    }
  },
  warn: (msg) => {
    console.warn(`[${formatTime()}] [WARN] ${msg}`);
  },
  error: (msg, err) => {
    console.error(`[${formatTime()}] [ERROR] ${msg}`, err || '');
  },
  success: (msg) => {
    // Print in green color in terminal
    console.log(`\x1b[32m[${formatTime()}] [SUCCESS] ${msg}\x1b[0m`);
  }
};

module.exports = logger;
