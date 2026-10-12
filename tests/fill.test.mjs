// Run: cd tests && npm i jsdom && cd .. && node tests/fill.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const { JSDOM } = createRequire(path.join(here, 'package.json'))('jsdom');
const { buildAnswers } = await import('../lib/answers.js');
const { defaultPayload } = await import('../lib/vault.js').catch(() => ({ defaultPayload: null }));

const mapperSrc = fs.readFileSync(path.join(here, '../content/mapper.js'), 'utf8');
const fillerSrc = fs.readFileSync(path.join(here, '../content/filler.js'), 'utf8');

// ---- profile used by every test ----
const payload = {
  profile: {
    personal: { firstName: 'Arya', lastName: 'Pandey', preferredName: '', email: 'arya@example.com', phoneCountryCode: '+91', phone: '9876543210' },
    address: { line1: '12 MG Road', line2: 'Flat 4', line3: 'Near Park', city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001', country: 'India' },
    links: { linkedin: 'https://linkedin.com/in/arya', github: 'https://github.com/arya', portfolio: 'https://arya.dev', website: '', twitter: '' },
    work: { currentCompany: 'Acme', currentTitle: 'Software Engineer', yearsExperience: '4', noticePeriod: '30 days', currentSalary: '12 LPA', expectedSalary: '18 LPA', startDate: 'Immediately' },
    education: { school: 'Gujarat University', degree: "Bachelor's", fieldOfStudy: 'Computer Science', gradYear: '2022', gpa: '8.5' },
    eligibility: { authorizedToWork: true, requiresSponsorship: false, willingToRelocate: true, workedForCompanyBefore: false, referralSource: 'LinkedIn' },
    eeo: { gender: 'decline', ethnicity: '', veteran: '', disability: '' },
    summary: 'Backend engineer.',
    skills: [], experience: [
      { company: 'Acme', title: 'Software Engineer', bullets: ['Built APIs', 'Cut latency by 40%'] },
      { company: 'Globex', title: 'Intern', bullets: ['Wrote tests'] }
    ],
    customAnswers: [{ match: 'pronouns?', answer: 'he/him' }]
  },
  drafts: { coverLetter: 'Dear team, hello.' }
};

function load(html, mutate) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', url: 'https://boards.example.com/apply' });
  const w = dom.window;
  w.eval(mapperSrc);
  w.eval(fillerSrc);
  const answers = buildAnswers(payload);
  if (mutate) mutate(answers);
  return { w, d: w.document, answers, run: (opts = {}) => w.__ATSF.run(answers, { skipLayoutCheck: true, highlight: false, passDelay: 20, ...opts }) };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); }
}
const val = (d, sel) => d.querySelector(sel).value;

// ============ Greenhouse-style ============
const GREENHOUSE = `
<form id="application_form">
  <div class="field"><label for="first_name">First Name <span>*</span></label><input id="first_name" name="job_application[first_name]" type="text" required></div>
  <div class="field"><label for="last_name">Last Name <span>*</span></label><input id="last_name" name="job_application[last_name]" type="text" required></div>
  <div class="field"><label for="email">Email <span>*</span></label><input id="email" name="job_application[email]" type="text" required></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" name="job_application[phone]" type="text"></div>
  <div class="field"><label for="resume">Resume/CV <span>*</span></label><input id="resume" type="file" required></div>
  <div class="field"><label for="cover_letter_text">Cover Letter</label><textarea id="cover_letter_text" name="cover_letter_text"></textarea></div>
  <div class="field"><label for="question_1">LinkedIn Profile</label><input id="question_1" name="job_application[answers_attributes][0][text_value]" type="text"></div>
  <div class="field"><label for="question_2">Website</label><input id="question_2" name="job_application[answers_attributes][1][text_value]" type="text"></div>
  <div class="field"><label for="question_3">Are you legally authorized to work in the United States? *</label>
    <select id="question_3"><option value="">--</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <div class="field"><label for="question_4">Will you now or in the future require sponsorship for employment visa status? *</label>
    <select id="question_4"><option value="">--</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <div class="field"><label for="question_5">How did you hear about this job?</label><input id="question_5" type="text"></div>
  <div class="field"><label for="question_6">Pronouns</label><input id="question_6" type="text"></div>
  <div class="field"><label for="g">Gender</label>
    <select id="g"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
</form>`;
console.log('Greenhouse-style');
await test('fills identity, links, cover letter, yes/no selects, referral, custom answer, EEO decline', async () => {
  const { d, run } = load(GREENHOUSE);
  const r = await run();
  assert.equal(val(d, '#first_name'), 'Arya');
  assert.equal(val(d, '#last_name'), 'Pandey');
  assert.equal(val(d, '#email'), 'arya@example.com');
  assert.equal(val(d, '#phone'), '9876543210');
  assert.equal(val(d, '#cover_letter_text'), 'Dear team, hello.');
  assert.equal(val(d, '#question_1'), 'https://linkedin.com/in/arya');
  assert.equal(val(d, '#question_2'), 'https://arya.dev', 'website falls back to portfolio');
  assert.equal(d.querySelector('#question_3').selectedOptions[0].text, 'Yes');
  assert.equal(d.querySelector('#question_4').selectedOptions[0].text, 'No');
  assert.equal(val(d, '#question_5'), 'LinkedIn');
  assert.equal(val(d, '#question_6'), 'he/him');
  assert.equal(d.querySelector('#g').selectedOptions[0].text, 'Decline To Self Identify');
  assert.ok(r.needsAttention.some((n) => /resume/i.test(n.label)), 'resume upload flagged for manual attach');
});

// ============ Lever-style ============
const LEVER = `
<form>
  <label><div class="application-label">Full name</div><div class="application-field"><input type="text" name="name" required></div></label>
  <label><div class="application-label">Email</div><div class="application-field"><input type="email" name="email" required></div></label>
  <label><div class="application-label">Phone</div><div class="application-field"><input type="text" name="phone"></div></label>
  <label><div class="application-label">Current company</div><div class="application-field"><input type="text" name="org"></div></label>
  <label><div class="application-label">LinkedIn URL</div><div class="application-field"><input type="text" name="urls[LinkedIn]"></div></label>
  <label><div class="application-label">GitHub URL</div><div class="application-field"><input type="text" name="urls[GitHub]"></div></label>
  <label><div class="application-label">Portfolio URL</div><div class="application-field"><input type="text" name="urls[Portfolio]"></div></label>
  <label><div class="application-label">Additional information</div><div class="application-field"><textarea name="comments"></textarea></div></label>
</form>`;
console.log('Lever-style');
await test('Lever name="name" is full name, org is current company, urls[...] map', async () => {
  const { d, run } = load(LEVER);
  await run();
  assert.equal(val(d, '[name="name"]'), 'Arya Pandey');
  assert.equal(val(d, '[name="email"]'), 'arya@example.com');
  assert.equal(val(d, '[name="phone"]'), '9876543210');
  assert.equal(val(d, '[name="org"]'), 'Acme');
  assert.equal(val(d, '[name="urls[LinkedIn]"]'), 'https://linkedin.com/in/arya');
  assert.equal(val(d, '[name="urls[GitHub]"]'), 'https://github.com/arya');
  assert.equal(val(d, '[name="urls[Portfolio]"]'), 'https://arya.dev');
});
await test('"Additional information" is NOT auto-filled with random profile text', async () => {
  const { d, run } = load(LEVER);
  await run();
  assert.equal(val(d, '[name="comments"]'), '');
});

// ============ Workday-style (data-automation-id, no/odd labels) ============
const WORKDAY = `
<div>
  <div><label for="w1">First Name</label><input id="w1" data-automation-id="legalNameSection_firstName" type="text"></div>
  <div><label for="w2">Last Name</label><input id="w2" data-automation-id="legalNameSection_lastName" type="text"></div>
  <div><label for="w3">Address Line 1</label><input id="w3" data-automation-id="addressSection_addressLine1" type="text"></div>
  <div><input id="w4" data-automation-id="addressSection_city" type="text"></div>
  <div><input id="w5" data-automation-id="addressSection_postalCode" type="text"></div>
  <div><label for="w6">Phone Number</label><input id="w6" data-automation-id="phone-number" type="text"></div>
  <div><label for="w7">Country Phone Code</label>
    <select id="w7"><option value="">Select One</option><option>United States of America (+1)</option><option>India (+91)</option><option>United Kingdom (+44)</option></select></div>
  <div><label for="w8">Country</label>
    <select id="w8"><option value="">Select One</option><option>United States of America</option><option>India</option><option>United Kingdom</option></select></div>
  <div><label for="w9">State</label>
    <select id="w9"><option value="">Select One</option><option>Gujarat</option><option>Goa</option></select></div>
</div>`;
console.log('Workday-style');
await test('maps via data-automation-id; selects match +91 / India / Gujarat', async () => {
  const { d, run } = load(WORKDAY);
  await run();
  assert.equal(val(d, '#w1'), 'Arya');
  assert.equal(val(d, '#w2'), 'Pandey');
  assert.equal(val(d, '#w3'), '12 MG Road');
  assert.equal(val(d, '#w4'), 'Ahmedabad', 'city from automation id with no label');
  assert.equal(val(d, '#w5'), '380001');
  assert.equal(val(d, '#w6'), '9876543210');
  assert.equal(d.querySelector('#w7').selectedOptions[0].text, 'India (+91)');
  assert.equal(d.querySelector('#w8').selectedOptions[0].text, 'India');
  assert.equal(d.querySelector('#w9').selectedOptions[0].text, 'Gujarat');
});

// ============ Radios / checkboxes / ranges ============
const RADIOS = `
<form>
  <fieldset><legend>Are you authorized to work in India?</legend>
    <label><input type="radio" name="auth" value="y"> Yes</label><label><input type="radio" name="auth" value="n"> No</label></fieldset>
  <fieldset><legend>Do you require visa sponsorship?</legend>
    <label><input type="radio" name="spons" value="y"> Yes</label><label><input type="radio" name="spons" value="n"> No</label></fieldset>
  <div class="q"><div>Are you willing to relocate?</div>
    <label><input type="radio" name="reloc" value="1"> Yes</label><label><input type="radio" name="reloc" value="0"> No</label></div>
  <label><input type="checkbox" name="terms"> I agree to the terms and privacy policy</label>
  <label for="yrs">How many years of professional experience do you have?</label>
  <select id="yrs"><option value="">Select</option><option>Less than 1 year</option><option>1-3 years</option><option>4-6 years</option><option>7+ years</option></select>
</form>`;
console.log('Radios, checkboxes, ranges');
await test('radio groups answered by legend / nearby question text', async () => {
  const { d, run } = load(RADIOS);
  await run();
  assert.equal(d.querySelector('[name=auth][value=y]').checked, true);
  assert.equal(d.querySelector('[name=spons][value=n]').checked, true);
  assert.equal(d.querySelector('[name=reloc][value="1"]').checked, true);
});
await test('consent checkboxes are never ticked', async () => {
  const { d, run } = load(RADIOS);
  await run();
  assert.equal(d.querySelector('[name=terms]').checked, false);
});
await test('years of experience picks the right numeric range', async () => {
  let h = load(RADIOS); await h.run();
  assert.equal(h.d.querySelector('#yrs').selectedOptions[0].text, '4-6 years');
  h = load(RADIOS, (a) => { a.yearsExperience = '9'; }); await h.run();
  assert.equal(h.d.querySelector('#yrs').selectedOptions[0].text, '7+ years');
  h = load(RADIOS, (a) => { a.yearsExperience = '0.5'; }); await h.run();
  assert.equal(h.d.querySelector('#yrs').selectedOptions[0].text, 'Less than 1 year');
});
await test('unknown (null) eligibility answers are not guessed', async () => {
  const { d, run } = load(RADIOS, (a) => { a.workAuth = null; });
  await run();
  assert.equal(d.querySelector('[name=auth][value=y]').checked, false);
  assert.equal(d.querySelector('[name=auth][value=n]').checked, false);
});

// ============ Safety / negatives ============
const NEGATIVE = `
<form>
  <label for="cn">Company name</label><input id="cn" type="text">
  <label for="ref">Name of your reference</label><input id="ref" type="text">
  <label for="school">School name</label><input id="school" type="text">
  <label for="pw">Password</label><input id="pw" type="password">
  <label for="q">Search jobs</label><input id="q" type="search">
  <div style="display:none"><label for="hp">Website</label><input id="hp" name="website" type="text"></div>
  <label for="ro">Email</label><input id="ro" type="email" readonly value="locked@x.com">
  <label for="dis">Phone</label><input id="dis" type="tel" disabled>
  <label for="pre">First name</label><input id="pre" type="text" value="Already">
</form>`;
console.log('Safety');
await test('does not misclassify company/reference names as the candidate name', async () => {
  const { d, run } = load(NEGATIVE);
  await run();
  assert.equal(val(d, '#cn'), '');
  assert.equal(val(d, '#ref'), '');
});
await test('school name maps to school, never to full name', async () => {
  const { d, run } = load(NEGATIVE);
  await run();
  assert.equal(val(d, '#school'), 'Gujarat University');
});
await test('skips password, search, hidden honeypot, readonly, disabled', async () => {
  const { d, run } = load(NEGATIVE);
  await run();
  assert.equal(val(d, '#pw'), '');
  assert.equal(val(d, '#q'), '');
  assert.equal(val(d, '#hp'), '');
  assert.equal(val(d, '#ro'), 'locked@x.com');
  assert.equal(val(d, '#dis'), '');
});
await test('does not overwrite existing values unless asked', async () => {
  let h = load(NEGATIVE); await h.run();
  assert.equal(val(h.d, '#pre'), 'Already');
  h = load(NEGATIVE); await h.run({ overwrite: true });
  assert.equal(val(h.d, '#pre'), 'Arya');
});
await test('results never contain the filled values (only labels/keys)', async () => {
  const { run } = load(GREENHOUSE);
  const r = await run();
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes('arya@example.com') && !blob.includes('9876543210'));
});

// ============ Framework compatibility ============
console.log('Framework compatibility');
await test('React-style controlled input: native setter used + input/change events fire', async () => {
  const { w, d, run } = load('<label for="e">Email</label><input id="e" type="text">');
  const input = d.getElementById('e');
  let tracked = 0, inputEvents = 0, changeEvents = 0;
  // React installs an instance-level value property to track changes; writing via the prototype setter bypasses it.
  const proto = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { tracked++; proto.set.call(this, v); } });
  input.addEventListener('input', () => inputEvents++);
  input.addEventListener('change', () => changeEvents++);
  await run();
  assert.equal(proto.get.call(input), 'arya@example.com');
  assert.equal(tracked, 0, 'must bypass the instance-level tracker so React notices the change');
  assert.ok(inputEvents >= 1 && changeEvents >= 1);
});
await test('react-select style combobox: types, waits, clicks the matching option', async () => {
  const html = '<label for="g">Gender</label><input id="g" role="combobox" type="text">';
  const { w, d, run } = load(html, (a) => { a.gender = 'Female'; });
  const input = d.getElementById('g');
  input.addEventListener('input', () => {
    d.querySelectorAll('.menu').forEach((n) => n.remove());
    const menu = d.createElement('div'); menu.className = 'menu';
    for (const t of ['Male', 'Female', 'Non-binary']) {
      const o = d.createElement('div'); o.setAttribute('role', 'option'); o.textContent = t;
      o.addEventListener('click', () => { input.dataset.chosen = t; });
      menu.append(o);
    }
    d.body.append(menu);
  });
  const r = await run();
  assert.equal(input.dataset.chosen, 'Female');
  assert.ok(r.filled.some((f) => f.key === 'gender'));
});
await test('finds fields inside open shadow roots', async () => {
  const { w, d, run } = load('<div id="host"></div>');
  const root = d.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML = '<label for="s1">First name</label><input id="s1" type="text">';
  await run();
  assert.equal(root.getElementById('s1').value, 'Arya');
});
await test('phone includes country code when the field asks for it', async () => {
  const { d, run } = load('<label for="p">Phone (including country code)</label><input id="p" type="text">');
  await run();
  assert.equal(val(d, '#p'), '+91 9876543210');
});


// ============ Reported Workday issues ============
console.log('Workday issues (v1.1)');

// Workday-like address block: Country is a button dropdown; choosing it re-renders State + Postal Code (wiping values).
function workdayAddress(d) {
  d.body.innerHTML = `
    <label for="cty">Country</label><button id="cty" aria-haspopup="listbox" data-automation-id="countryDropdown">Select One</button>
    <div id="dyn"><label for="pc0">Postal Code *</label><input id="pc0" data-automation-id="addressSection_postalCode" required></div>`;
  const openList = (btn, items, onPick) => {
    d.querySelectorAll('.pop').forEach((n) => n.remove());
    const ul = d.createElement('ul'); ul.className = 'pop'; ul.setAttribute('role', 'listbox');
    for (const t of items) {
      const li = d.createElement('li'); li.setAttribute('role', 'option'); li.textContent = t;
      li.addEventListener('click', () => { btn.textContent = t; ul.remove(); onPick(t); });
      ul.append(li);
    }
    d.body.append(ul);
  };
  d.getElementById('cty').addEventListener('click', (e) => {
    openList(e.currentTarget, ['United States of America', 'India', 'United Kingdom'], () => {
      setTimeout(() => { // async re-render, wipes previous Postal Code
        d.getElementById('dyn').innerHTML = `
          <label for="st">State</label><button id="st" aria-haspopup="listbox" aria-label="State Select One Required">Select One</button>
          <label for="pc1">Postal Code *</label><input id="pc1" data-automation-id="addressSection_postalCode" required>`;
        d.getElementById('st').addEventListener('click', (ev) => openList(ev.currentTarget, ['Goa', 'Gujarat', 'Kerala'], () => {}));
      }, 30);
    });
  });
}
await test('Postal Code + State survive a Country re-render (multi-pass) and State button dropdown is picked', async () => {
  const { d, run } = load('<div></div>');
  workdayAddress(d);
  const r = await run({ passDelay: 150 });
  assert.equal(d.getElementById('cty').textContent, 'India');
  assert.equal(d.getElementById('st').textContent, 'Gujarat');
  assert.equal(val(d, '#pc1'), '380001');
  assert.ok(!r.needsAttention.some((n) => /postal/i.test(n.label)), 'postal code not flagged');
});
await test('value wiped by the framework right after typing is re-applied', async () => {
  const { d, run } = load('<label for="e">Email</label><input id="e" type="text">');
  const input = d.getElementById('e');
  let wiped = false;
  input.addEventListener('change', () => { if (!wiped) { wiped = true; setTimeout(() => { input.value = ''; }, 10); } });
  await run({ passDelay: 60 });
  assert.equal(input.value, 'arya@example.com');
});
await test('"Have you ever worked for that company or its subsidiaries?" is answered from the profile', async () => {
  const html = `<fieldset><legend>Have you ever worked for that particular company or any wholly/majority-owned subsidiaries of that company? *</legend>
    <label><input type="radio" name="prev" value="1"> Yes</label><label><input type="radio" name="prev" value="0"> No</label></fieldset>`;
  let h = load(html); await h.run();
  assert.equal(h.d.querySelector('[name=prev][value="0"]').checked, true);
  h = load(html, (a) => { a.previousEmployee = true; }); await h.run();
  assert.equal(h.d.querySelector('[name=prev][value="1"]').checked, true);
  h = load(html, (a) => { a.previousEmployee = null; }); const r = await h.run();
  assert.equal(h.d.querySelector('[name=prev][value="0"]').checked || h.d.querySelector('[name=prev][value="1"]').checked, false, 'unknown stays unanswered');
  assert.ok(r.needsAttention.length >= 1, 'flagged for the user');
});
await test('Address Line 1/2/3 map to the right lines', async () => {
  const { d, run } = load(`<label for="a1">Address Line 1</label><input id="a1"><label for="a2">Address Line 2</label><input id="a2"><label for="a3">Address Line 3</label><input id="a3">`);
  await run();
  assert.equal(val(d, '#a1'), '12 MG Road');
  assert.equal(val(d, '#a2'), 'Flat 4');
  assert.equal(val(d, '#a3'), 'Near Park');
});
await test('"Role Description" is NOT treated as years of experience; repeated job blocks use successive jobs', async () => {
  const block = (n) => `<div>
    <label for="t${n}">Job Title *</label><input id="t${n}" data-automation-id="workExperience-${n}--jobTitle">
    <label for="c${n}">Company *</label><input id="c${n}" data-automation-id="workExperience-${n}--companyName">
    <label for="r${n}">Role Description *</label><textarea id="r${n}" data-automation-id="workExperience-${n}--roleDescription"></textarea></div>`;
  const { d, run } = load(block(1) + block(2));
  const r = await run();
  assert.equal(val(d, '#t1'), 'Software Engineer');
  assert.equal(val(d, '#c1'), 'Acme');
  assert.equal(val(d, '#r1'), '• Built APIs\n• Cut latency by 40%');
  assert.equal(val(d, '#t2'), 'Intern');
  assert.equal(val(d, '#c2'), 'Globex');
  assert.equal(val(d, '#r2'), '• Wrote tests');
  assert.ok(!r.needsAttention.some((n) => /yearsExperience/.test(n.reason)), 'no yearsExperience complaints');
});
await test('generic "URL" field gets a website/portfolio/LinkedIn link', async () => {
  const { d, run } = load('<label for="u">URL *</label><input id="u" type="text" required>');
  const r = await run();
  assert.equal(val(d, '#u'), 'https://arya.dev');
  assert.equal(r.needsAttention.length, 0);
});
await test('years-of-experience questions still work', async () => {
  const { d, run } = load('<label for="y">Total years of experience</label><input id="y" type="number">');
  await run();
  assert.equal(val(d, '#y'), '4');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
