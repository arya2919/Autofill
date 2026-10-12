// Smart field mapper: decides which profile answer belongs in which form control.
// Signals (autocomplete, type, name/id, data-* hooks, label, aria-label, placeholder,
// group question text) are matched against regex definitions and scored.
// Classic script (injected on demand); exposes window.__ATSF.mapper.
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.__ATSF = root.__ATSF || {};

  // ---------- text normalisation ----------
  function norm(str) {
    return String(str || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> words
      .replace(/[_\-.\[\]\/:*()]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // ---------- field definitions ----------
  // key        : name of the answer in buildAnswers()
  // patterns   : tested against EVERY signal (labels, placeholders, attrs ...)
  // attrPatterns: tested only against attribute signals (name/id/data-*), e.g. Lever's name="org"
  // not        : if a signal matches any of these, that signal is ignored for this def
  // kind       : 'text' (default) | 'bool'
  // question   : allowed to match long question-style labels (> LONG chars)
  // Order matters: earlier = wins ties, so put specific defs before generic ones.
  const D = (key, patterns, extra) => Object.assign({ key, patterns, kind: 'text' }, extra || {});

  const DEFS = [
    // ----- custom answers are handled separately (highest priority) -----

    // contact / identity
    D('emailConfirm', [/(confirm|verify|re ?enter|retype|repeat).{0,20}e ?mail/, /e ?mail.{0,20}(confirm|verification|again)/]),
    D('preferredName', [/\b(preferred|nick|chosen|known as)\b.{0,12}\bname\b/, /\bpreferred first name\b/]),
    D('firstName', [/\b(first|given|fore) ?name\b/, /\bfname\b/, /^first$/], { not: [/preferred|nick|middle|last|sur|family/] }),
    D('lastName', [/\b(last|sur|family) ?name\b/, /\blname\b/, /\bsurname\b/, /^last$/], { not: [/preferred|nick|middle|first/] }),
    D('fullName', [/\bfull ?name\b/, /\blegal name\b/, /\byour name\b/, /^name$/, /^candidate name$/, /^applicant name$/], {
      not: [/company|school|employer|reference|manager|file|user|business|organi[sz]ation|referr|emergency|first|last|middle|sur|given|family|preferred/]
    }),
    D('email', [/\be ?mail\b/, /\bemail address\b/], { not: [/confirm|verify|re ?enter|retype|alternate|secondary|referr|friend|manager/], types: ['email'] }),
    D('phoneCountryCode', [/country ?(phone ?)?code/, /phone ?(country )?code/, /dial(ing)? code/], { not: [/\b(including|include|incl|with|inc)\s+(the\s+)?country ?code/] }),
    D('phone', [/\b(phone|mobile|cell|telephone|tel|contact) ?(number|no|num)?\b/, /\bwhatsapp\b/], {
      not: [/(?<!\b(including|include|incl|with|inc)\s+(the\s+)?)\b(country|dial(ing)?|area) ?code\b/, /country(?! ?code)/, /extension|\bext\b|device|type|emergency|referr|fax/],
      types: ['tel']
    }),

    // location
    D('addressLine3', [/\b(address|street|addr)( line)? ?(3|three)\b/]),
    D('addressLine2', [/\b(address|street|addr)( line)? ?(2|two)\b/, /\b(apt|apartment|suite|unit|flat)\b/]),
    D('addressLine1', [/\b(street )?address( line)?( ?1| one)?\b/, /\bstreet( address)?\b/, /\baddr(ess)? ?1\b/], {
      not: [/email|e mail|web|ip |line ?[23]|address ?[23]|line (two|three)|url|city|state|zip|postal|country/]
    }),
    D('city', [/\bcity\b/, /\btown\b/, /\bcity town\b/], { not: [/ability|capacity|authority/] }),
    D('postalCode', [/\b(zip|postal|post) ?(code)?\b/, /\bpin ?code\b/, /\bzip\b/]),
    D('state', [/\b(state|province|region|county)\b/], { not: [/united states|statement|real estate|reside|authoriz|country region/] }),
    D('country', [/\bcountry\b/, /\bcountry region\b/], { not: [/code|phone|birth|citizen|nationality/] }),
    D('location', [/\b(current |preferred )?location\b/, /\bwhere are you (based|located)\b/, /\bcity,? state\b/], { not: [/relocat|office|work location|prefer/] }),

    // links
    D('linkedin', [/linked ?in/]),
    D('github', [/\bgit ?hub\b/]),
    D('twitter', [/\b(twitter|x com)\b/]),
    D('portfolio', [/\bportfolio\b/, /\bwork samples?\b/, /\bdribbble\b|\bbehance\b/]),
    D('website', [/\b(personal )?(web ?site|homepage|home page|blog)\b/, /\bpersonal (url|link|site)\b/, /\bother (url|link|website)\b/], { not: [/company|linked/] }),

    D('anyUrl', [/^(url|link|web address|profile url)$/], { not: [/linked|git/] }),

    // work
    D('currentSalary', [/\bcurrent (ctc|salary|compensation|pay|package|remuneration)\b/, /\bpresent (ctc|salary)\b/, /\bctc current\b/]),
    D('expectedSalary', [/\b(expected|desired|target|ask(ing)?) (ctc|salary|compensation|pay|package|rate)\b/, /\bsalary expectations?\b/, /\bcompensation expectations?\b/, /\bexpected ctc\b/]),
    D('noticePeriod', [/\bnotice ?period\b/, /\bnotice\b.{0,20}\b(days|weeks|months)\b/]),
    D('startDate', [/\b(earliest )?(start|joining|available) ?(date|from)\b/, /\bwhen can you (start|join)\b/, /\bavailability to (start|join)\b/]),
    D('yearsExperience', [
      /\byears?\b.{0,30}\bexperience\b/, /\bexperience\b.{0,25}\byears?\b/, /\bhow many years\b/,
      /\b(total|overall) (work |professional |industry )?experience\b/
    ], { question: true, not: [/describe|summar|tell us|list|company|employer|responsib|why|explain|role description|description/] }),
    D('currentCompany', [/\b(current|present|most recent|latest|previous|last) (company|employer|organi[sz]ation)\b/, /\bcompany (name )?\(?current\)?\b/], {
      attrPatterns: [/^(org|organi[sz]ation|company|employer|current company|company name)$/, /\b(work experience|employment|work history)\b.*\b(company|employer)\b/]
    }),
    D('currentTitle', [/\b(current|present|most recent|latest) (job )?(title|position|role|designation)\b/, /\bjob title\b/, /\bdesignation\b/], {
      not: [/desired|preferred|apply|applying/],
      attrPatterns: [/\b(work experience|employment|work history)\b.*\b(job title|title|position)\b/]
    }),

    // education
    D('fieldOfStudy', [/\b(field|area) of study\b/, /\bdiscipline\b/, /\bmajor\b/, /\bspecial[iy]s?[sz]ation\b/, /\bstream\b/, /\bbranch\b/]),
    D('degree', [/\bdegree\b/, /\bqualification\b/, /\blevel of education\b/, /\bhighest education\b/], { not: [/field|major/] }),
    D('gradYear', [/\b(graduation|grad|passing|completion) ?(year|date)\b/, /\byear of (graduation|passing|completion)\b/]),
    D('gpa', [/\b(gpa|cgpa)\b/, /\b(grade point|percentage|marks)\b/]),
    D('school', [/\b(school|university|college|institution|institute|alma mater)\b/], { not: [/high school|reference|name of (the )?recruiter|referr|date|year|degree|major|field/] }),

    // free text
    D('roleDescription', [/\brole description\b/, /\bjob description\b/, /\b(key )?responsibilities\b/, /\bdescribe your (role|duties|responsibilities)\b/],
      { textOnly: true, question: true, not: [/apply|applying|position you/] }),
    D('coverLetter', [/\bcover ?letter\b/, /\bletter of (interest|motivation)\b/, /\bmotivation letter\b/], { textOnly: true }),
    D('summary', [/\b(professional |career )?summary\b/, /\babout (you|yourself)\b/, /\btell us about yourself\b/, /\bshort bio\b|\bbio\b/], { textOnly: true, question: true, not: [/cover/] }),

    // eligibility (booleans -> yes/no)
    D('sponsorship', [/\b(require|need|requires|will you (now or in the future )?(require|need))\b.{0,40}\bsponsor/, /\bvisa sponsorship\b/, /\bsponsorship\b/], { kind: 'bool', question: true }),
    D('workAuth', [
      /\b(legally )?(authori[sz]ed|eligible|permitted|entitled|right) to work\b/,
      /\bwork authori[sz]ation\b/, /\bauthori[sz]ed to work\b/, /\bright to work\b/
    ], { kind: 'bool', question: true, not: [/sponsor/] }),
    D('relocate', [/\b(willing|open|able|ready) to relocate\b/, /\brelocation\b/], { kind: 'bool', question: true }),

    D('previousEmployee', [
      /\b(ever|previously|formerly)\b.{0,40}\b(work(ed)?|employ(ed)?)\b.{0,60}\b(for|at|with|by)\b/,
      /\bworked for\b.{0,80}\b(company|subsidiar|organi[sz]ation)/,
      /\b(former|previous|prior|past) (employee|worker)\b/, /\bprevious ?worker\b/, /\bpreviously (employed|worked)\b/
    ], { kind: 'bool', question: true }),

    // referral + EEO (voluntary)
    D('referralSource', [/\bhow did you (hear|find|learn)\b/, /\bwhere did you (hear|find|learn)\b/, /\bsource of (application|referral)\b/, /\bhow (you )?heard\b/], { question: true }),
    D('gender', [/\bgender\b/, /\bsex\b/], { question: true, not: [/identity expression/] }),
    D('ethnicity', [/\b(race|ethnicity|ethnic)\b/, /\brace ethnicity\b/], { question: true }),
    D('veteran', [/\bveteran\b/, /\bprotected veteran\b/, /\bmilitary\b/], { question: true }),
    D('disability', [/\bdisabilit(y|ies)\b/], { question: true })
  ];

  // Standard HTML autocomplete tokens -> keys (strongest signal, WHATWG-defined)
  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', nickname: 'preferredName',
    email: 'email', tel: 'phoneInternational', 'tel-national': 'phone', 'tel-country-code': 'phoneCountryCode',
    'street-address': 'addressLine1', 'address-line1': 'addressLine1', 'address-line2': 'addressLine2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'postalCode',
    country: 'country', 'country-name': 'country', organization: 'currentCompany', 'organization-title': 'currentTitle',
    url: 'website'
  };

  const LONG = 70; // labels longer than this are "questions"; only question:true defs may match them
  const THRESHOLD = 50;

  // ---------- DOM signal collection ----------
  function textOf(node) {
    return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function labelTexts(el) {
    const out = [];
    try {
      if (el.labels && el.labels.length) for (const l of el.labels) out.push(textOf(l));
    } catch (e) { /* ignore */ }
    if (!out.length) {
      const wrap = el.closest && el.closest('label');
      if (wrap) out.push(textOf(wrap));
    }
    const lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      for (const id of lb.split(/\s+/)) {
        const n = el.ownerDocument.getElementById(id);
        if (n) out.push(textOf(n));
      }
    }
    return out.filter(Boolean);
  }

  // Preceding short text near the control (for sites without proper <label for>)
  function nearbyText(el) {
    let cur = el;
    for (let depth = 0; depth < 3 && cur && cur.parentElement; depth++) {
      let sib = cur.previousElementSibling;
      while (sib) {
        if (!/^(INPUT|SELECT|TEXTAREA|SCRIPT|STYLE)$/.test(sib.tagName)) {
          const t = textOf(sib);
          if (t && t.length <= 120 && !sib.querySelector('input,select,textarea')) return t;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return '';
  }

  function groupInputs(el) {
    if (!el.name) return [el];
    const scope = el.form || el.ownerDocument;
    return Array.from(scope.querySelectorAll('input[name="' + (window.CSS && CSS.escape ? CSS.escape(el.name) : el.name) + '"]'))
      .filter((n) => n.type === el.type);
  }

  // The question text for a radio/checkbox group (what the options answer)
  function groupQuestion(el) {
    const fs = el.closest && el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && textOf(lg)) return textOf(lg);
    }
    const grp = el.closest && el.closest('[role="radiogroup"],[role="group"]');
    if (grp) {
      const lb = grp.getAttribute('aria-labelledby');
      if (lb) {
        const t = lb.split(/\s+/).map((id) => textOf(el.ownerDocument.getElementById(id))).join(' ').trim();
        if (t) return t;
      }
      const al = grp.getAttribute('aria-label');
      if (al) return al;
    }
    // climb until the container holds every input of the group, then strip option labels
    const members = groupInputs(el);
    let box = el.parentElement;
    for (let i = 0; i < 5 && box; i++) {
      if (members.every((m) => box.contains(m)) && (box.querySelectorAll('input').length >= members.length)) {
        if (members.length > 1 || i >= 1) break;
      }
      box = box.parentElement;
    }
    if (!box) return '';
    let q = textOf(box);
    for (const m of members) for (const lt of labelTexts(m)) q = q.replace(lt, ' ');
    q = q.replace(/\s+/g, ' ').trim();
    return q.length > 300 ? q.slice(0, 300) : q;
  }

  function optionLabel(el) {
    const l = labelTexts(el);
    return l[0] || el.value || '';
  }

  function attrSignals(el) {
    const a = (n) => (el.getAttribute && el.getAttribute(n)) || '';
    return [
      a('name'), el.id, a('data-automation-id'), a('data-qa'), a('data-testid'), a('data-test'),
      a('data-field'), a('data-name'), a('formcontrolname'), a('ng-model')
    ].filter(Boolean).map(norm);
  }

  function textSignals(el) {
    const type = (el.type || '').toLowerCase();
    const sig = [];
    if (type === 'radio' || type === 'checkbox') {
      const q = groupQuestion(el);
      if (q) sig.push(norm(q));
    } else {
      for (const t of labelTexts(el)) sig.push(norm(t));
    }
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) sig.push(norm(al));
    const ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) sig.push(norm(ph));
    if (!sig.length) {
      const near = nearbyText(el);
      if (near) sig.push(norm(near));
    }
    return sig.filter(Boolean);
  }

  // ---------- matching ----------
  const anyMatch = (res, s) => res.some((r) => r.test(s));

  function scoreDef(def, attrs, texts, type) {
    let best = 0;
    const test = (sig, weight, isAttr) => {
      if (def.not && anyMatch(def.not, sig)) return;
      const hit = anyMatch(def.patterns, sig) || (isAttr && def.attrPatterns && anyMatch(def.attrPatterns, sig));
      if (!hit) return;
      if (!isAttr && sig.length > LONG && !def.question) return;
      if (weight > best) best = weight;
    };
    for (const s of attrs) test(s, 70, true);
    texts.forEach((s, i) => test(s, i === 0 ? 75 : 60, false)); // first label text is strongest
    if (def.types && def.types.includes(type)) best = Math.max(best, 90);
    return best;
  }

  /**
   * Classify one form control.
   * @returns {{key:string, score:number, kind:string, source:string} | null}
   */
  function classify(el, customAnswers) {
    const type = (el.type || '').toLowerCase();
    const attrs = attrSignals(el);
    const texts = textSignals(el);

    // 1) user-defined custom answers win
    if (customAnswers && customAnswers.length) {
      const hay = attrs.concat(texts);
      for (let i = 0; i < customAnswers.length; i++) {
        let re;
        try { re = new RegExp(customAnswers[i].match, 'i'); } catch (e) { continue; }
        const raw = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')].concat(labelTexts(el), type === 'radio' || type === 'checkbox' ? [groupQuestion(el)] : []);
        if (raw.concat(hay).some((s) => s && re.test(s))) {
          return { key: 'custom:' + i, score: 100, kind: 'text', source: 'custom' };
        }
      }
    }

    // 2) standard autocomplete attribute
    const ac = ((el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop()) || '';
    if (AUTOCOMPLETE[ac]) {
      return { key: AUTOCOMPLETE[ac], score: 100, kind: 'text', source: 'autocomplete' };
    }

    // 3) regex defs on attributes + labels
    let best = null;
    for (const def of DEFS) {
      if (def.textOnly && !(el.tagName === 'TEXTAREA' || el.isContentEditable)) continue;
      const sc = scoreDef(def, attrs, texts, type);
      if (sc >= THRESHOLD && (!best || sc > best.score)) {
        best = { key: def.key, score: sc, kind: def.kind, source: 'pattern' };
      }
    }
    return best;
  }

  function describe(el) {
    const type = (el.type || '').toLowerCase();
    const t = type === 'radio' || type === 'checkbox' ? groupQuestion(el) : labelTexts(el)[0];
    return (t || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || el.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  root.__ATSF.mapper = {
    norm, classify, describe, labelTexts, groupQuestion, groupInputs, optionLabel, textSignals, attrSignals, DEFS
  };
})();
