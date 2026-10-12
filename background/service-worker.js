import { getPayload, touch, lock } from '../lib/vault.js';
import { buildAnswers } from '../lib/answers.js';

// ---- auto-lock ----
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autolock') lock();
});

// ---- keyboard shortcut (Alt+Shift+F by default; remap at chrome://extensions/shortcuts) ----
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-form') return;
  const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (t && t.id !== undefined) await fillTab(t.id, {});
});

// ---- messages from the popup ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'FILL') {
    fillTab(msg.tabId, msg.opts || {}).then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e && e.message || e) }));
    return true; // async response
  }
  return false;
});

// ---- core ----
async function fillTab(tabId, opts) {
  const payload = await getPayload();
  if (!payload) {
    await toast(tabId, 'ATS Autofill is locked. Click the extension icon and enter your master password.');
    await badge(tabId, 'LOCK', '#b45309');
    return { ok: false, reason: 'locked' };
  }
  await touch();

  const answers = buildAnswers(payload);
  const options = { overwrite: !!opts.overwrite, highlight: opts.highlight !== false };

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/mapper.js', 'content/filler.js']
    });
  } catch (e) {
    await badge(tabId, 'ERR', '#b91c1c');
    return { ok: false, reason: "Can't run on this page (browser-internal pages and the Web Store are blocked): " + (e && e.message || e) };
  }

  let frames = [];
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (a, o) => (window.__ATSF ? window.__ATSF.run(a, o) : null),
      args: [answers, options]
    });
  } catch (e) {
    await badge(tabId, 'ERR', '#b91c1c');
    return { ok: false, reason: String(e && e.message || e) };
  }

  const filled = [];
  const attention = [];
  let formsSeen = 0;
  for (const f of frames) {
    const r = f && f.result;
    if (!r) continue;
    formsSeen += r.fieldsScanned || 0;
    filled.push(...r.filled);
    attention.push(...r.needsAttention);
  }

  const msg = filled.length
    ? `ATS Autofill: filled ${filled.length} field${filled.length === 1 ? '' : 's'}` +
      (attention.length ? `, ${attention.length} need${attention.length === 1 ? 's' : ''} your attention.` : '.')
    : formsSeen
      ? 'ATS Autofill: nothing new to fill (fields already have values, or your profile has nothing for them).'
      : 'ATS Autofill: no form fields found. If the application is inside an embedded frame, enable "embedded forms" in Settings.';
  await toast(tabId, msg);
  await badge(tabId, filled.length ? String(filled.length) : '0', filled.length ? '#15803d' : '#6b7280');

  return { ok: true, filled, needsAttention: attention, scanned: formsSeen };
}

async function badge(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 6000);
  } catch { /* tab may be gone */ }
}

// Self-contained toast injected into the top frame only.
async function toast(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (message) => {
        const id = '__atsf_toast__';
        document.getElementById(id)?.remove();
        const el = document.createElement('div');
        el.id = id;
        el.textContent = message;
        el.style.cssText =
          'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:10px 14px;' +
          'background:#111827;color:#fff;font:13px/1.4 system-ui,sans-serif;border-radius:8px;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.35);';
        document.documentElement.appendChild(el);
        setTimeout(() => el.remove(), 5500);
      },
      args: [text]
    });
  } catch { /* restricted page */ }
}
