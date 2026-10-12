// Run: node tests/unit.test.mjs   (needs Node 20+)
import assert from 'node:assert/strict';

// ---- minimal chrome.* mock ----
const mk = () => { const m = new Map(); return {
  async get(k) { if (k == null) return Object.fromEntries(m); const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const x of keys) if (m.has(x)) o[x] = structuredClone(m.get(x)); return o; },
  async set(o) { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
  async remove(k) { for (const x of [].concat(k)) m.delete(x); },
  _m: m }; };
const alarms = { created: [], async clear() {}, create(n, o) { this.created.push([n, o]); } };
globalThis.chrome = { storage: { local: mk(), session: mk() }, alarms };

const vault = await import('../lib/vault.js');
const { buildAnswers } = await import('../lib/answers.js');
const cl = await import('../lib/coverletter.js');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

console.log('vault');
await t('no vault initially, not unlocked', async () => {
  assert.equal(await vault.hasVault(), false);
  assert.equal(await vault.isUnlocked(), false);
  assert.equal(await vault.getPayload(), null);
});
await t('rejects short password', async () => {
  await assert.rejects(() => vault.createVault('short'), /at least 8/);
});

const p = vault.defaultPayload();
p.profile.personal.firstName = 'Arya';
p.profile.personal.email = 'arya@example.com';
p.ai.apiKey = 'sk-secret-key-123';

await t('create vault, data is encrypted at rest (no plaintext)', async () => {
  await vault.createVault('correct horse battery', p);
  const raw = JSON.stringify((await chrome.storage.local.get('vault')).vault);
  assert.ok(!raw.includes('Arya'));
  assert.ok(!raw.includes('arya@example.com'));
  assert.ok(!raw.includes('sk-secret-key-123'));
  assert.ok(alarms.created.length > 0, 'auto-lock alarm scheduled');
});
await t('unlocked after create; payload round-trips', async () => {
  assert.equal(await vault.isUnlocked(), true);
  assert.deepEqual(await vault.getPayload(), p);
});
await t('lock clears session key', async () => {
  await vault.lock();
  assert.equal(await vault.getPayload(), null);
});
await t('wrong password rejected', async () => {
  await assert.rejects(() => vault.unlock('wrong password!'), /Wrong master password/);
  assert.equal(await vault.isUnlocked(), false);
});
await t('right password unlocks', async () => {
  const got = await vault.unlock('correct horse battery');
  assert.equal(got.profile.personal.firstName, 'Arya');
});
await t('save uses a fresh IV and persists', async () => {
  const before = (await chrome.storage.local.get('vault')).vault;
  const next = structuredClone(p); next.profile.personal.lastName = 'Pandey';
  await vault.savePayload(next);
  const after = (await chrome.storage.local.get('vault')).vault;
  assert.notEqual(before.iv, after.iv);
  assert.notEqual(before.ct, after.ct);
  assert.equal((await vault.getPayload()).profile.personal.lastName, 'Pandey');
});
await t('tampered ciphertext is rejected (auth tag) and locks', async () => {
  const rec = (await chrome.storage.local.get('vault')).vault;
  const bad = { ...rec, ct: rec.ct.slice(0, -4) + (rec.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await chrome.storage.local.set({ vault: bad });
  assert.equal(await vault.getPayload(), null);
  await chrome.storage.local.set({ vault: rec }); // restore
  await vault.unlock('correct horse battery');
});
await t('change password', async () => {
  await assert.rejects(() => vault.changePassword('nope nope nope', 'new password 1'), /Wrong/);
  await vault.changePassword('correct horse battery', 'new password 1');
  await vault.lock();
  await assert.rejects(() => vault.unlock('correct horse battery'), /Wrong/);
  const got = await vault.unlock('new password 1');
  assert.equal(got.profile.personal.lastName, 'Pandey');
});
await t('backup export/import round trip', async () => {
  const backup = await vault.exportBackup();
  assert.ok(!backup.includes('Arya'));
  await vault.wipe();
  assert.equal(await vault.hasVault(), false);
  await assert.rejects(() => vault.importBackup('{"foo":1}'), /not an ATS Autofill backup/);
  await vault.importBackup(backup);
  const got = await vault.unlock('new password 1');
  assert.equal(got.profile.personal.firstName, 'Arya');
});

console.log('answers');
await t('buildAnswers flattens profile', async () => {
  const pl = vault.defaultPayload();
  Object.assign(pl.profile.personal, { firstName: 'Arya', lastName: 'Pandey', email: 'a@b.co', phoneCountryCode: '+91', phone: '9876543210' });
  Object.assign(pl.profile.address, { city: 'Ahmedabad', state: 'Gujarat', country: 'India' });
  pl.profile.eligibility.authorizedToWork = true;
  pl.profile.eligibility.requiresSponsorship = false;
  const a = buildAnswers(pl);
  assert.equal(a.fullName, 'Arya Pandey');
  assert.equal(a.phone, '9876543210');
  assert.equal(a.phoneInternational, '+91 9876543210');
  assert.equal(a.location, 'Ahmedabad, Gujarat, India');
  assert.equal(a.workAuth, true);
  assert.equal(a.sponsorship, false);
  assert.equal(a.relocate, null); // unknown -> never filled
});

console.log('cover letter');
const prof = {
  personal: { firstName: 'Arya', lastName: 'Pandey', email: 'a@b.co' },
  work: { currentTitle: 'Software Engineer', currentCompany: 'Acme', yearsExperience: '4' },
  links: { linkedin: 'https://linkedin.com/in/arya' },
  summary: '',
  skills: ['Node.js', 'React', 'AWS', 'C++', 'Kubernetes'],
  experience: [{ company: 'Acme', title: 'Software Engineer', bullets: [
    'Cut API latency by 40% using Redis caching in Node.js services',
    'Organised the office party every year',
    'Built React dashboards used by 2,000 daily users'] }]
};
const jd = `We are hiring a Senior Backend Engineer. You will build scalable Node.js APIs, work with AWS and Kubernetes,
  and collaborate with React front-end engineers. Experience with GraphQL and Terraform is a plus. Node.js and AWS are essential.`;
await t('hasTerm handles symbols', async () => {
  assert.ok(cl.hasTerm('we use C++ and Node.js', 'C++'));
  assert.ok(cl.hasTerm('we use C++ and Node.js', 'Node.js'));
  assert.ok(!cl.hasTerm('we use Java', 'C++'));
  assert.ok(!cl.hasTerm('javascript', 'java'));
});
await t('analysis finds matched skills and gaps', async () => {
  const a = cl.analyse(prof, jd);
  assert.deepEqual(new Set(a.matchedSkills), new Set(['Node.js', 'React', 'AWS', 'Kubernetes']));
  assert.ok(a.missing.some((m) => /graphql|terraform/.test(m)), 'missing: ' + a.missing.join(','));
  assert.ok(a.score > 0 && a.score <= 100);
});
await t('irrelevant bullet ranks last', async () => {
  const r = cl.rankBullets(prof, jd, 3);
  assert.match(r[r.length - 1].text, /office party/);
  assert.match(r[0].text, /Node\.js|React/);
});
await t('letter drafted with company/role/bullets', async () => {
  const out = cl.draftLetter({ profile: prof }, { company: 'Globex', role: 'Backend Engineer', jd, bullets: 2 });
  assert.match(out.letter, /Dear Globex Hiring Team,/);
  assert.match(out.letter, /Backend Engineer position at Globex/);
  assert.match(out.letter, /4\+ years of experience as a Software Engineer at Acme/);
  assert.ok(!/office party/.test(out.letter), 'irrelevant bullet excluded');
  assert.match(out.letter, /Arya Pandey/);
});

console.log(`\n${passed} unit tests passed`);
