// HoodScope Telegram bot — sends premium alerts via the Telegram Bot API.
// Configure TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID; without them the module
// runs in dry-run mode (logs exactly what would be pushed) so the pipeline
// is testable before credentials exist.
'use strict';

const API = 'https://api.telegram.org/bot';

function escHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Send one message (HTML parse mode). Returns { sent:true } or { sent:false, dryRun:true, ... }
async function sendMessage(text, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    const preview = String(text).slice(0, 300);
    console.log('[hoodscope:telegram] DRY-RUN push -> chat ' + (chatId || '(unset)') + ': ' + preview.replace(/\n/g, ' | '));
    return { sent: false, dryRun: true };
  }
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  try {
    const r = await fetch(API + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error('telegram ' + r.status + ' ' + (j.description || ''));
    return { sent: true, messageId: j.result && j.result.message_id };
  } catch (e) {
    console.error('[hoodscope:telegram] send failed:', e.message);
    return { sent: false, error: e.message };
  }
}

module.exports = { sendMessage, isConfigured, escHtml };
