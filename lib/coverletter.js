// Local (offline) job-description analysis + cover letter drafting.
// No network. Everything runs in the popup.

const STOP = new Set(('a an and are as at be but by for from has have in into is it its of on or our that the their this to ' +
  'we with you your will can able about all also any more other such than them they these those who what when where which ' +
  'while within without work working role team join us job position candidate candidates experience years year plus ' +
  'strong good great excellent ability skills skill knowledge understanding including etc using use used new key ' +
  'looking seeking responsibilities requirements qualifications preferred required should must may per one two ' +
  'across over under between through well best make help build building ensure highly').split(/\s+/));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary-ish test that also works for terms like "C++", "Node.js", ".NET". */
export function hasTerm(text, term) {
  const t = term.trim();
  if (!t) return false;
  const re = new RegExp('(^|[^a-z0-9+#.])' + esc(t.toLowerCase()) + '(?![a-z0-9+#])', 'i');
  return re.test(text.toLowerCase());
}

/** Top JD terms (unigrams + bigrams), most frequent first. */
export function jdKeywords(jd, limit = 25) {
  const words = jd.toLowerCase().replace(/[^a-z0-9+#.\s/-]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, '')).filter(Boolean);
  const counts = new Map();
  const bump = (k, w) => counts.set(k, (counts.get(k) || 0) + w);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    bump(w, 1);
    const n = words[i + 1];
    if (n && !STOP.has(n) && n.length > 1 && !/^\d+$/.test(n)) bump(w + ' ' + n, 1.5);
  }
  // drop unigrams that are fully covered by a stronger bigram
  const sorted = [...counts.entries()].filter(([, c]) => c >= 2 || jd.length < 1500).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, limit).map(([k]) => k);
}

// Common technical vocabulary so plain-lowercase mentions ("terraform", "kubernetes") are recognised.
const TECH = new Set(('javascript typescript python java kotlin swift golang rust ruby php scala sql nosql html css sass react angular vue ' +
  'svelte nextjs nodejs node.js express django flask fastapi spring rails laravel graphql rest grpc aws azure gcp docker kubernetes ' +
  'terraform ansible jenkins git github gitlab ci/cd cicd devops linux bash redis kafka rabbitmq postgres postgresql mysql mongodb ' +
  'dynamodb elasticsearch snowflake spark hadoop airflow dbt tableau powerbi excel pandas numpy pytorch tensorflow scikit-learn ' +
  'machine-learning nlp llm microservices serverless agile scrum jira figma selenium cypress jest pytest junit testing oauth ' +
  'saml sso android ios flutter firebase salesforce sap tally seo analytics etl api apis sdk saas').split(/\s+/));
const NOT_TECH_CAPS = new Set(['US', 'USA', 'UK', 'EU', 'CEO', 'CTO', 'CFO', 'EEO', 'HR', 'FAQ', 'PTO', 'OK', 'AM', 'PM', 'ID', 'IT', 'AI', 'EOE', 'LGBTQ']);

/** Technology-looking terms in the JD: known vocab, symbols (C++, C#, Node.js), CamelCase, ACRONYMS. */
export function techTerms(jd) {
  const counts = new Map();
  const tokens = jd.match(/[A-Za-z][A-Za-z0-9+#.\-/]*[A-Za-z0-9+#]|[A-Za-z]/g) || [];
  for (const raw of tokens) {
    const t = raw.replace(/[.\-/]+$/, '');
    const lower = t.toLowerCase();
    const isTech = TECH.has(lower) || /[+#]/.test(t) || /\.(js|net)$/i.test(t) || /^[A-Z][a-z]+[A-Z]/.test(t) ||
      (/^[A-Z]{2,6}$/.test(t) && !NOT_TECH_CAPS.has(t));
    if (isTech && !STOP.has(lower)) counts.set(lower, (counts.get(lower) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Compare profile skills with the JD. */
export function analyse(profile, jd) {
  const skills = (profile.skills || []).map((s) => String(s).trim()).filter(Boolean);
  const matched = skills.filter((s) => hasTerm(jd, s));
  const haystack = [skills.join(' '), (profile.summary || ''),
    ...(profile.experience || []).flatMap((e) => [e.title || '', ...(e.bullets || [])])].join(' ');
  const tech = techTerms(jd);
  // Prefer technical terms; fall back to generic keywords for non-technical roles.
  const kws = tech.length >= 5 ? tech.slice(0, 30) : [...tech, ...jdKeywords(jd)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 25);
  const covered = kws.filter((k) => hasTerm(haystack, k));
  const missing = kws.filter((k) => !hasTerm(haystack, k)).slice(0, 12);
  const score = Math.round((100 * covered.length) / Math.max(1, kws.length));
  return { matchedSkills: matched, keywords: kws, covered, missing, score: Math.min(100, score) };
}

/** Rank experience bullets by relevance to the JD. */
export function rankBullets(profile, jd, n = 4) {
  const terms = new Set([...(profile.skills || []).filter((s) => hasTerm(jd, s)).map((s) => s.toLowerCase()), ...jdKeywords(jd, 40)]);
  const all = [];
  (profile.experience || []).forEach((e, ei) => {
    (e.bullets || []).forEach((b, bi) => {
      const text = String(b).trim();
      if (!text) return;
      let score = 0;
      for (const t of terms) if (hasTerm(text, t)) score += t.includes(' ') ? 2 : 1;
      if (/\d/.test(text)) score += 0.5; // quantified bullets read better
      score += Math.max(0, 0.3 - ei * 0.1); // slight recency bias
      all.push({ text, score, company: e.company || '', title: e.title || '' });
    });
  });
  return all.sort((a, b) => b.score - a.score).slice(0, n);
}

/** Draft a letter locally from a template. */
export function draftLetter(payload, { company = '', role = '', manager = '', jd = '', bullets = 4 } = {}) {
  const p = payload.profile;
  const per = p.personal || {};
  const wrk = p.work || {};
  const name = [per.firstName, per.lastName].filter(Boolean).join(' ');
  const a = analyse(p, jd);
  const top = rankBullets(p, jd, bullets);
  const years = wrk.yearsExperience ? `${wrk.yearsExperience}+ years of experience` : 'hands-on experience';
  const title = wrk.currentTitle ? ` as ${/^[aeiou]/i.test(wrk.currentTitle) ? 'an' : 'a'} ${wrk.currentTitle}` : '';
  const at = company ? ` at ${company}` : '';
  const greeting = manager ? `Dear ${manager},` : company ? `Dear ${company} Hiring Team,` : 'Dear Hiring Team,';
  const skillsLine = a.matchedSkills.length
    ? `My toolkit overlaps closely with what you are looking for, including ${list(a.matchedSkills.slice(0, 8))}.`
    : '';

  const parts = [greeting, ''];
  parts.push(`I am excited to apply for the ${role || 'open'} position${at}. With ${years}${title}${wrk.currentCompany ? ` at ${wrk.currentCompany}` : ''}, I am confident I can contribute from day one.`);
  if (p.summary) parts.push('', p.summary.trim());
  if (top.length) {
    parts.push('', 'A few highlights most relevant to this role:');
    top.forEach((b) => parts.push(`• ${b.text.replace(/^[•\-*]\s*/, '')}`));
  }
  if (skillsLine) parts.push('', skillsLine);
  parts.push('', `I would welcome the chance to discuss how my background fits ${company || 'your team'}'s goals. Thank you for your time and consideration.`);
  parts.push('', 'Best regards,', name);
  const contact = [per.email, p.links && p.links.linkedin].filter(Boolean).join(' | ');
  if (contact) parts.push(contact);

  return { letter: parts.join('\n'), analysis: a, bullets: top };
}

function list(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}
