// Optional AI drafting. Providers:
//  - "anthropic": Claude Messages API (your own API key)
//  - "openai":    any OpenAI-compatible /chat/completions endpoint, including local servers
//                 such as Ollama (http://localhost:11434/v1) or LM Studio (http://localhost:1234/v1)
// The API key is stored inside the encrypted vault. Only the data listed in buildPrompt() is sent:
// name, current title/company, summary, skills, selected bullets, and the job description.
// Email, phone, address and EEO/eligibility answers are NEVER included.

import { rankBullets, analyse } from './coverletter.js';

export function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`; // host-permission patterns ignore ports
}

export function endpointFor(ai) {
  if (ai.provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  const base = (ai.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Set the API base URL in Settings.');
  return base + '/chat/completions';
}

export async function ensureHostPermission(ai) {
  const pattern = originPattern(endpointFor(ai));
  const has = await chrome.permissions.contains({ origins: [pattern] });
  if (has) return;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error('Permission to contact ' + pattern + ' was not granted.');
}

export function buildPrompt(payload, { company, role, manager, jd, tone }) {
  const p = payload.profile;
  const per = p.personal || {};
  const wrk = p.work || {};
  const bullets = rankBullets(p, jd, 6).map((b) => `- ${b.text}`).join('\n');
  const a = analyse(p, jd);
  const system =
    'You write concise, specific, honest cover letters. Use only facts from the candidate data provided; ' +
    'never invent employers, numbers, degrees or skills. No clichés, no filler. 200-280 words. ' +
    'Plain text only: greeting, 2-3 short paragraphs, sign-off.';
  const user = [
    `Company: ${company || '(unknown)'}`,
    `Role: ${role || '(unknown)'}`,
    manager ? `Hiring manager: ${manager}` : '',
    `Tone: ${tone || 'professional and warm'}`,
    '',
    'CANDIDATE',
    `Name: ${[per.firstName, per.lastName].filter(Boolean).join(' ')}`,
    `Current: ${[wrk.currentTitle, wrk.currentCompany].filter(Boolean).join(' at ')}`,
    wrk.yearsExperience ? `Years of experience: ${wrk.yearsExperience}` : '',
    p.summary ? `Summary: ${p.summary}` : '',
    `Skills: ${(p.skills || []).join(', ')}`,
    `Most relevant achievements:\n${bullets}`,
    `Skills that overlap with the job: ${a.matchedSkills.join(', ') || 'n/a'}`,
    '',
    'JOB DESCRIPTION',
    jd.slice(0, 6000)
  ].filter((l) => l !== '').join('\n');
  return { system, user };
}

export async function generateWithAI(payload, opts) {
  const ai = payload.ai || {};
  if (!ai.model) throw new Error('Set a model name in Settings.');
  if (ai.provider === 'anthropic' && !ai.apiKey) throw new Error('Add your API key in Settings.');
  await ensureHostPermission(ai);
  const { system, user } = buildPrompt(payload, opts);
  const url = endpointFor(ai);

  let res;
  if (ai.provider === 'anthropic') {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: ai.model, max_tokens: 1024, system, messages: [{ role: 'user', content: user }] })
    });
  } else {
    const headers = { 'content-type': 'application/json' };
    if (ai.apiKey) headers.authorization = 'Bearer ' + ai.apiKey;
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: ai.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    });
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`AI request failed (${res.status}). ${body}`);
  }
  const data = await res.json();
  const text = ai.provider === 'anthropic'
    ? (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    : data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('The AI returned an empty response.');
  return text.trim();
}
