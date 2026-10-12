// Encrypted vault: PBKDF2 (SHA-256) -> AES-GCM 256.
// - The encrypted record lives in chrome.storage.local ("vault").
// - While unlocked, the derived key lives ONLY in chrome.storage.session
//   (in-memory, cleared when the browser closes, not readable by content scripts).

const VAULT_KEY = 'vault';
const SESSION_KEY = 'sk';
const PREFS_KEY = 'prefs';
const ITERATIONS = 600000;
const AAD = new TextEncoder().encode('ats-autofill:v1');
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- helpers ----------
function toB64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so it can be parked in storage.session while unlocked
    ['encrypt', 'decrypt']
  );
}

async function encryptWith(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    key,
    enc.encode(JSON.stringify(obj))
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function decryptWith(key, record) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(record.iv), additionalData: AAD },
    key,
    fromB64(record.ct)
  );
  return JSON.parse(dec.decode(pt));
}

async function exportKeyB64(key) {
  return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}
async function importKeyB64(b64) {
  return crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// ---------- default data ----------
export function defaultPayload() {
  return {
    version: 1,
    profile: {
      personal: { firstName: '', lastName: '', preferredName: '', email: '', phoneCountryCode: '', phone: '' },
      address: { line1: '', line2: '', line3: '', city: '', state: '', postalCode: '', country: '' },
      links: { linkedin: '', github: '', portfolio: '', website: '', twitter: '' },
      work: { currentCompany: '', currentTitle: '', yearsExperience: '', noticePeriod: '', currentSalary: '', expectedSalary: '', startDate: '' },
      education: { school: '', degree: '', fieldOfStudy: '', gradYear: '', gpa: '' },
      eligibility: { authorizedToWork: '', requiresSponsorship: '', willingToRelocate: '', workedForCompanyBefore: '', referralSource: '' },
      eeo: { gender: '', ethnicity: '', veteran: '', disability: '' },
      summary: '',
      skills: [],
      experience: [],
      customAnswers: []
    },
    ai: { provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-5-5', apiKey: '' },
    drafts: { coverLetter: '' }
  };
}

// ---------- prefs (not secret) ----------
export async function getPrefs() {
  const r = await chrome.storage.local.get(PREFS_KEY);
  return { autoLockMinutes: 60, ...(r[PREFS_KEY] || {}) };
}
export async function setPrefs(p) {
  const cur = await getPrefs();
  await chrome.storage.local.set({ [PREFS_KEY]: { ...cur, ...p } });
  if (await isUnlocked()) await touch();
}

// ---------- state ----------
export async function hasVault() {
  const r = await chrome.storage.local.get(VAULT_KEY);
  return !!r[VAULT_KEY];
}
export async function isUnlocked() {
  const r = await chrome.storage.session.get(SESSION_KEY);
  return !!r[SESSION_KEY];
}

/** (Re)start the auto-lock timer. Call on unlock and on every use. */
export async function touch() {
  if (!chrome.alarms) return;
  const { autoLockMinutes } = await getPrefs();
  await chrome.alarms.clear('autolock');
  if (autoLockMinutes > 0) chrome.alarms.create('autolock', { delayInMinutes: autoLockMinutes });
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
  if (chrome.alarms) await chrome.alarms.clear('autolock');
}

// ---------- create / unlock / read / write ----------
export async function createVault(password, payload = defaultPayload()) {
  if (!password || password.length < 8) throw new Error('Master password must be at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  const { iv, ct } = await encryptWith(key, payload);
  const record = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), iv, ct };
  await chrome.storage.local.set({ [VAULT_KEY]: record });
  await chrome.storage.session.set({ [SESSION_KEY]: await exportKeyB64(key) });
  await touch();
  return payload;
}

export async function unlock(password) {
  const r = await chrome.storage.local.get(VAULT_KEY);
  const record = r[VAULT_KEY];
  if (!record) throw new Error('No vault found. Create one first.');
  const key = await deriveKey(password, fromB64(record.salt), record.iter);
  let payload;
  try {
    payload = await decryptWith(key, record);
  } catch {
    throw new Error('Wrong master password.');
  }
  await chrome.storage.session.set({ [SESSION_KEY]: await exportKeyB64(key) });
  await touch();
  return payload;
}

/** Returns the decrypted payload, or null when locked / no vault. */
export async function getPayload() {
  const s = await chrome.storage.session.get(SESSION_KEY);
  const r = await chrome.storage.local.get(VAULT_KEY);
  if (!s[SESSION_KEY] || !r[VAULT_KEY]) return null;
  try {
    return await decryptWith(await importKeyB64(s[SESSION_KEY]), r[VAULT_KEY]);
  } catch {
    await lock();
    return null;
  }
}

export async function savePayload(payload) {
  const s = await chrome.storage.session.get(SESSION_KEY);
  const r = await chrome.storage.local.get(VAULT_KEY);
  if (!s[SESSION_KEY] || !r[VAULT_KEY]) throw new Error('Vault is locked.');
  const key = await importKeyB64(s[SESSION_KEY]);
  const { iv, ct } = await encryptWith(key, payload); // fresh IV on every save
  await chrome.storage.local.set({ [VAULT_KEY]: { ...r[VAULT_KEY], iv, ct } });
  await touch();
}

export async function changePassword(oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
  const payload = await unlock(oldPassword); // verifies the old password
  await createVault(newPassword, payload);
}

// ---------- backup / wipe ----------
export async function exportBackup() {
  const r = await chrome.storage.local.get(VAULT_KEY);
  if (!r[VAULT_KEY]) throw new Error('Nothing to export.');
  return JSON.stringify({ app: 'ats-autofill', ...r[VAULT_KEY] }, null, 2); // still encrypted
}

export async function importBackup(jsonText) {
  let rec;
  try { rec = JSON.parse(jsonText); } catch { throw new Error('Not valid JSON.'); }
  const ok = rec && rec.app === 'ats-autofill' && rec.salt && rec.iv && rec.ct && rec.iter;
  if (!ok) throw new Error('This is not an ATS Autofill backup file.');
  const { app, ...record } = rec;
  await chrome.storage.local.set({ [VAULT_KEY]: record });
  await lock(); // user must enter that backup's password
}

export async function wipe() {
  await chrome.storage.local.remove([VAULT_KEY, PREFS_KEY]);
  await lock();
}
