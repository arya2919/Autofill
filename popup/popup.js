import * as vault from '../lib/vault.js';
import { SECTIONS, getPath, setPath, EXAMPLE_ADVANCED } from './schema.js';
import { draftLetter } from '../lib/coverletter.js';
import { generateWithAI } from '../lib/ai.js';

const $ = (id) => document.getElementById(id);
let payload = null; // decrypted vault contents while the popup is open

// ---------- tiny UI helpers ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  kids.flat().forEach((c) => n.append(c));
  return n;
}
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function banner(msg, isError) {
  const b = $('banner');
  if (!msg) { b.classList.add('hidden'); return; }
  b.textContent = msg;
  b.classList.toggle('error', !!isError);
  b.classList.remove('hidden');
}
function show(screen) {
  for (const s of ['setup', 'unlock', 'main']) $('screen-' + s).classList.toggle('hidden', s !== screen);
  $('btn-lock').classList.toggle('hidden', screen !== 'main');
}
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- boot ----------
async function init() {
  banner('');
  if (!(await vault.hasVault())) return show('setup');
  if (await vault.isUnlocked()) {
    payload = await vault.getPayload();
    if (payload) return enterMain();
  }
  show('unlock');
  $('unlock-pw').focus();
}

function enterMain() {
  show('main');
  renderProfile();
  renderSettings();
  loadShortcut();
  if (!payload.profile.personal.firstName && !payload.profile.personal.email) {
    banner('Welcome! Fill in the Profile tab first, then use Autofill on any job application.');
    switchTab('profile');
  }
}

async function loadShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === 'fill-form');
    $('kbd-shortcut').textContent = c && c.shortcut ? c.shortcut : 'not set';
  } catch { /* ignore */ }
}

// ---------- setup / unlock / lock ----------
$('btn-create').onclick = (e) => busy(e.target, async () => {
  const a = $('setup-pw').value, b = $('setup-pw2').value;
  if (a !== b) return toast('Passwords do not match.');
  try {
    e.target.textContent = 'Encrypting…';
    payload = await vault.createVault(a);
    $('setup-pw').value = $('setup-pw2').value = '';
    enterMain();
  } catch (err) { toast(err.message); }
});

async function doUnlock() {
  const btn = $('btn-unlock');
  await busy(btn, async () => {
    try {
      btn.textContent = 'Unlocking…';
      payload = await vault.unlock($('unlock-pw').value);
      $('unlock-pw').value = '';
      enterMain();
    } catch (err) { toast(err.message); }
  });
}
$('btn-unlock').onclick = doUnlock;
$('unlock-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });
$('setup-pw2').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create').click(); });

$('btn-lock').onclick = async () => { await vault.lock(); payload = null; show('unlock'); };

// ---------- tabs ----------
function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

// ---------- FILL ----------
$('btn-fill').onclick = (e) => busy(e.target, async () => {
  e.target.textContent = 'Filling…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return toast('No active tab.');
  const res = await chrome.runtime.sendMessage({
    type: 'FILL', tabId: tab.id, opts: { overwrite: $('opt-overwrite').checked, highlight: true }
  });
  renderFillResult(res);
});

function renderFillResult(res) {
  const box = $('fill-result');
  box.classList.remove('hidden');
  box.replaceChildren();
  if (!res || !res.ok) {
    box.append(el('p', { class: 'warn', text: res && res.reason === 'locked' ? 'Vault is locked.' : (res && res.reason) || 'Something went wrong.' }));
    return;
  }
  box.append(el('h4', { class: 'ok', text: `Filled ${res.filled.length} field${res.filled.length === 1 ? '' : 's'}` }));
  if (res.filled.length) {
    box.append(el('ul', {}, res.filled.map((f) => el('li', { text: f.label || f.key }))));
  } else {
    box.append(el('p', { class: 'muted', text: res.scanned ? 'Nothing new to fill: those fields already have values, or your profile has nothing for them (see below).' : 'No form fields found on this page.' }));
  }
  if (res.needsAttention.length) {
    box.append(el('h4', { text: 'Needs your attention' }));
    box.append(el('ul', {}, res.needsAttention.map((f) => el('li', { class: 'warn', text: `${f.label}: ${f.reason}` }))));
  }
  box.append(el('p', { class: 'muted small', text: 'Always review the form before you submit.' }));
}

// ---------- PROFILE ----------
function renderProfile() {
  const host = $('profile-form');
  host.replaceChildren();
  for (const sec of SECTIONS) {
    const fs = el('fieldset', {}, el('legend', { text: sec.title }));
    if (sec.note) fs.append(el('p', { class: 'muted small', text: sec.note }));
    for (const f of sec.fields) {
      let input;
      const val = getPath(payload.profile, f.path);
      if (f.type === 'textarea') {
        input = el('textarea', { rows: '4' });
        input.value = val || '';
      } else if (f.type === 'tri') {
        input = el('select', {}, el('option', { value: '', text: '— don\'t fill —' }), el('option', { value: 'true', text: 'Yes' }), el('option', { value: 'false', text: 'No' }));
        input.value = val === true ? 'true' : val === false ? 'false' : '';
      } else if (f.type === 'tags') {
        input = el('input', { type: 'text' });
        input.value = (val || []).join(', ');
      } else {
        input = el('input', { type: f.type === 'number' ? 'number' : (f.type || 'text') });
        if (f.type === 'number') input.setAttribute('min', '0');
        input.value = val === undefined || val === null ? '' : val;
      }
      if (f.placeholder) input.setAttribute('placeholder', f.placeholder);
      input.dataset.path = f.path;
      input.dataset.ftype = f.type || 'text';
      fs.append(el('label', {}, f.label, input));
    }
    host.append(fs);
  }
  $('adv-json').value = JSON.stringify(
    { experience: payload.profile.experience || [], customAnswers: payload.profile.customAnswers || [] }, null, 2);
}

$('btn-adv-example').onclick = () => { $('adv-json').value = JSON.stringify(EXAMPLE_ADVANCED, null, 2); };

$('btn-save-profile').onclick = (e) => busy(e.target, async () => {
  let adv;
  try { adv = JSON.parse($('adv-json').value || '{}'); } catch (err) { return toast('Advanced JSON is invalid: ' + err.message, 6000); }
  if (adv.experience !== undefined && !Array.isArray(adv.experience)) return toast('"experience" must be an array.');
  if (adv.customAnswers !== undefined && !Array.isArray(adv.customAnswers)) return toast('"customAnswers" must be an array.');
  for (const c of adv.customAnswers || []) {
    try { new RegExp(c.match); } catch { return toast('Invalid regex in customAnswers: ' + c.match, 6000); }
  }

  const next = structuredClone(payload);
  document.querySelectorAll('#profile-form [data-path]').forEach((inp) => {
    const t = inp.dataset.ftype;
    let v = inp.value;
    if (t === 'tri') v = v === 'true' ? true : v === 'false' ? false : '';
    else if (t === 'tags') v = v.split(',').map((s) => s.trim()).filter(Boolean);
    else v = typeof v === 'string' ? v.trim() : v;
    setPath(next.profile, inp.dataset.path, v);
  });
  next.profile.experience = adv.experience || [];
  next.profile.customAnswers = adv.customAnswers || [];
  try {
    await vault.savePayload(next);
    payload = next;
    banner('');
    toast('Profile saved (encrypted).');
  } catch (err) { toast(err.message); }
});

// ---------- COVER LETTER ----------
function chips(host, items) {
  host.replaceChildren(...items.map((t) => el('span', { class: 'chip', text: t })));
  if (!items.length) host.append(el('span', { class: 'muted small', text: 'none' }));
}
function clInputs() {
  return { company: $('cl-company').value.trim(), role: $('cl-role').value.trim(), manager: $('cl-manager').value.trim(), jd: $('cl-jd').value };
}
function showAnalysis(a) {
  $('cl-analysis').classList.remove('hidden');
  $('cl-score').textContent = a.score;
  chips($('cl-matched'), a.matchedSkills);
  chips($('cl-missing'), a.missing);
}
$('cl-output').value = '';

$('btn-cl-local').onclick = (e) => busy(e.target, async () => {
  const inp = clInputs();
  if (inp.jd.trim().length < 40) return toast('Paste the job description first.');
  const r = draftLetter(payload, inp);
  $('cl-output').value = r.letter;
  showAnalysis(r.analysis);
});

$('btn-cl-ai').onclick = (e) => busy(e.target, async () => {
  const inp = clInputs();
  if (inp.jd.trim().length < 40) return toast('Paste the job description first.');
  try {
    e.target.textContent = 'Generating…';
    const text = await generateWithAI(payload, inp);
    $('cl-output').value = text;
    showAnalysis(draftLetter(payload, inp).analysis);
  } catch (err) { toast(err.message, 7000); }
});

$('btn-cl-copy').onclick = async () => {
  await navigator.clipboard.writeText($('cl-output').value);
  toast('Copied.');
};
$('btn-cl-save').onclick = async () => {
  const next = structuredClone(payload);
  next.drafts = next.drafts || {};
  next.drafts.coverLetter = $('cl-output').value;
  await vault.savePayload(next);
  payload = next;
  toast('Saved. It will be inserted into "Cover letter" boxes when you autofill.');
};

// ---------- SETTINGS ----------
async function renderSettings() {
  const prefs = await vault.getPrefs();
  $('set-autolock').value = prefs.autoLockMinutes;
  const ai = payload.ai || {};
  $('ai-provider').value = ai.provider || 'anthropic';
  $('ai-base').value = ai.baseUrl || '';
  $('ai-model').value = ai.model || '';
  $('ai-key').value = ai.apiKey || '';
  syncAiProvider();
}
function syncAiProvider() {
  $('ai-base-wrap').classList.toggle('hidden', $('ai-provider').value === 'anthropic');
}
$('ai-provider').onchange = syncAiProvider;

$('btn-save-autolock').onclick = async () => {
  const n = Math.max(0, Math.min(1440, parseInt($('set-autolock').value, 10) || 0));
  await vault.setPrefs({ autoLockMinutes: n });
  toast('Auto-lock saved.');
};

$('btn-save-ai').onclick = async () => {
  const next = structuredClone(payload);
  next.ai = { provider: $('ai-provider').value, baseUrl: $('ai-base').value.trim(), model: $('ai-model').value.trim(), apiKey: $('ai-key').value.trim() };
  await vault.savePayload(next);
  payload = next;
  toast('AI settings saved (encrypted).');
};

$('btn-change-pw').onclick = (e) => busy(e.target, async () => {
  try {
    e.target.textContent = 'Re-encrypting…';
    await vault.changePassword($('pw-old').value, $('pw-new').value);
    payload = await vault.getPayload();
    $('pw-old').value = $('pw-new').value = '';
    toast('Master password changed.');
  } catch (err) { toast(err.message.includes('Wrong') ? 'Current password is wrong.' : err.message); }
});

$('btn-export').onclick = async () => {
  const text = await vault.exportBackup(); // still encrypted
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: 'ats-autofill-backup.json' });
  document.body.append(a); a.click(); a.remove();
  toast('Encrypted backup downloaded. Keep it and remember your password.');
};
$('btn-export-copy').onclick = async () => {
  await navigator.clipboard.writeText(await vault.exportBackup());
  toast('Encrypted backup copied to clipboard.');
};

async function doImport(text) {
  try {
    await vault.importBackup(text);
    payload = null;
    toast('Backup imported. Enter that backup\'s master password.');
    $('import-text').value = $('import-text-setup').value = '';
    init();
  } catch (err) { toast(err.message, 6000); }
}
$('btn-import').onclick = () => doImport($('import-text').value);
$('btn-import-setup').onclick = () => doImport($('import-text-setup').value);

$('btn-perm-all').onclick = async () => {
  const ok = await chrome.permissions.request({ origins: ['https://*/*'] });
  toast(ok ? 'Embedded forms enabled.' : 'Permission not granted.');
};

$('btn-wipe').onclick = async () => {
  if (!confirm('Erase your encrypted profile, settings and password from this browser? This cannot be undone (backups you exported still work).')) return;
  await vault.wipe();
  payload = null;
  init();
};

init();
