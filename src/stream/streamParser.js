const logger = require('../lib/logger');

function extractTextFromChunk(dataJson) {
  let text = dataJson.choices?.[0]?.delta?.content || '';
  if (!text && dataJson.delta?.text) {
    text = dataJson.delta.text;
  }
  if (!text && dataJson.content) {
    text = dataJson.content;
  }
  if (!text && dataJson.text) {
    text = dataJson.text;
  }
  return text;
}

async function parseStreamResponse(response, sendSSE, sendLog) {
  const log = sendLog || ((level, msg) => logger[level](msg));
  const reader = response.body;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let hasStreamData = false;
  let rawAccumulated = '';

  for await (const chunk of reader) {
    const chunkStr = decoder.decode(chunk, { stream: true });
    rawAccumulated += chunkStr;
    buffer += chunkStr;

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('data:')) {
        hasStreamData = true;
        const rawData = trimmed.slice(5).trim();
        if (rawData === '[DONE]') continue;

        try {
          const dataJson = JSON.parse(rawData);

          // 1. Check for usage statistics
          if (dataJson.usage) {
            sendSSE({ type: 'usage', usage: dataJson.usage });
          }

          // 2. Extract reasoning/thinking delta content
          let thinking = dataJson.choices?.[0]?.delta?.reasoning_content || '';
          if (thinking) {
            sendSSE({ type: 'thinking', text: thinking });
          }

          // 3. Extract text content
          let text = extractTextFromChunk(dataJson);
          if (text) {
            sendSSE({ type: 'content', text });
          }
        } catch (e) {
          log('warn', `流式行解析失败。Raw: "${rawData.slice(0, 100)}..." | Error: ${e.message}`);
        }
      }
    }
  }

  const flushStr = decoder.decode();
  buffer += flushStr;
  rawAccumulated += flushStr;

  if (hasStreamData && buffer && buffer.trim().startsWith('data:')) {
    const rawData = buffer.trim().slice(5).trim();
    if (rawData !== '[DONE]') {
      try {
        const dataJson = JSON.parse(rawData);
        let text = extractTextFromChunk(dataJson);
        if (text) {
          sendSSE({ type: 'content', text });
        }
      } catch (e) {}
    }
  }

  // Fallback: If we completed the stream but NEVER saw any "data:" lines,
  // it means the provider returned a standard blocking JSON response. Let's parse it.
  if (!hasStreamData && rawAccumulated.trim()) {
    const trimmedRaw = rawAccumulated.trim();
    log('info', `未检测到流式 data: 前缀，尝试以同步 JSON 格式解析响应...`);
    try {
      const syncJson = JSON.parse(trimmedRaw);

      let text = syncJson.choices?.[0]?.message?.content || '';
      let thinking = syncJson.choices?.[0]?.message?.reasoning_content || '';

      if (!text && syncJson.content) {
        text = syncJson.content;
      }

      if (thinking) {
        sendSSE({ type: 'thinking', text: thinking });
      }
      if (text) {
        sendSSE({ type: 'content', text: text });
      } else {
        log('warn', `同步 JSON 中未找到 content。返回数据: ${trimmedRaw.slice(0, 300)}`);
      }
      if (syncJson.usage) {
        sendSSE({ type: 'usage', usage: syncJson.usage });
      }
    } catch (err) {
      log('error', `同步 JSON 解析失败。原始响应内容: "${trimmedRaw.slice(0, 500)}..." | 错误: ${err.message}`);
    }
  }
}

module.exports = {
  extractTextFromChunk,
  parseStreamResponse
};
