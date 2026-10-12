// Form filler: walks every control (including open shadow roots), asks the mapper what it is,
// then writes the right value in a way React/Angular/Vue forms actually notice.
// Runs several passes so fields that appear or get re-rendered after earlier answers
// (e.g. State / Postal Code after choosing a Country on Workday) are filled too.
// Classic script (injected on demand); exposes window.__ATSF.run(answers, opts).
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.__ATSF = root.__ATSF || {};
  const M = () => root.__ATSF.mapper;

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color',
    'date', 'datetime-local', 'month', 'week', 'time']);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CONTROL_SELECTOR = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], ' +
    'button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(select)';
  // keys that repeat once per job on work-history pages: nth occurrence -> nth experience entry
  const INDEXED = new Set(['currentCompany', 'currentTitle', 'roleDescription']);

  // ---------- DOM traversal ----------
  function deepQueryAll(rootNode, selector, out) {
    out = out || [];
    out.push(...rootNode.querySelectorAll(selector));
    const all = rootNode.querySelectorAll('*');
    for (const el of all) if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
    return out;
  }

  function hiddenByAncestor(el) {
    const view = el.ownerDocument.defaultView;
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 12; n = n.parentElement, i++) {
      if (n.hidden) return true;
      const cs = view.getComputedStyle(n);
      if (cs.display === 'none') return true;
      if (i === 0 && cs.visibility === 'hidden') return true;
    }
    return false;
  }

  function isVisible(el, opts) {
    const type = (el.type || '').toLowerCase();
    if (el.disabled || el.readOnly) return false;
    if (el.closest && el.closest('[data-atsf-skip],#__atsf_toast__')) return false;
    if (hiddenByAncestor(el)) return false;
    if (opts.skipLayoutCheck || type === 'radio' || type === 'checkbox') return true;
    const rects = el.getClientRects();
    if (!rects.length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    const view = el.ownerDocument.defaultView;
    if (r.left + r.width + (view.scrollX || 0) < 0) return false; // off-screen honeypot
    return true;
  }

  // ---------- value writers ----------
  function fire(el, type) {
    const view = el.ownerDocument.defaultView;
    let ev;
    if (type === 'input' && typeof view.InputEvent === 'function') {
      ev = new view.InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' });
    } else {
      ev = new view.Event(type, { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(ev);
  }

  function nativeSet(el, value) {
    const view = el.ownerDocument.defaultView;
    const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? view.HTMLSelectElement.prototype
      : view.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }

  function writeText(el, value) {
    try { el.focus(); } catch (e) { /* ignore */ }
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      nativeSet(el, value);
    }
    fire(el, 'input');
    fire(el, 'change');
    try { if (el.ownerDocument.activeElement === el) el.blur(); } catch (e) { /* ignore */ }
  }

  function highlight(el) {
    const prev = [el.style.outline, el.style.outlineOffset];
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '1px';
    setTimeout(() => { el.style.outline = prev[0]; el.style.outlineOffset = prev[1]; }, 6000);
  }

  function fireMouse(el, type) {
    const view = el.ownerDocument.defaultView;
    el.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, view }));
  }
  function fireKey(el, type, key) {
    const view = el.ownerDocument.defaultView;
    el.dispatchEvent(new view.KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  }
  const clickLike = (el) => ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => fireMouse(el, t));

  // ---------- option matching ----------
  const COUNTRY = { usa: 'united states', us: 'united states', 'u s': 'united states', 'u s a': 'united states',
    'united states of america': 'united states', uk: 'united kingdom', 'great britain': 'united kingdom',
    england: 'united kingdom', uae: 'united arab emirates' };
  function canon(s) {
    const n = M().norm(s);
    return COUNTRY[n] || n;
  }

  const DECLINE_RE = /\b(decline|prefer not|rather not|do not wish|don t wish|choose not|not to (say|disclose|answer|specify))\b/;
  const YES_RE = /^(yes|y|true|i am|i do|i will|i have|i can)\b/;
  const NO_RE = /^(no|n|false|i am not|i do not|i don t|i will not|i have not|i cannot)\b/;

  function rangeMatches(optText, n) {
    const t = optText.toLowerCase();
    const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (!nums.length) return false;
    if (/(less than|under|below|fewer|<)/.test(t)) return n < nums[0];
    if (nums.length >= 2 && /(-|–|—|to)/.test(t)) return n >= nums[0] && n <= nums[1];
    if (/(\+|more|over|above|at least|plus)/.test(t)) return n >= nums[0];
    return Math.floor(n) === nums[0];
  }

  function scoreOption(opt, desired, key) {
    const text = opt.text || '';
    const a = canon(text);
    const v = canon(opt.value || '');
    if (!a && !v) return 0;

    if (typeof desired === 'boolean') {
      const first = M().norm(text);
      if (desired && YES_RE.test(first)) return 100;
      if (!desired && NO_RE.test(first)) return 100;
      return 0;
    }
    const dRaw = String(desired);
    if (!dRaw) return 0;
    if (key === 'gender' || key === 'ethnicity' || key === 'veteran' || key === 'disability') {
      if (/^decline/i.test(dRaw.trim())) return DECLINE_RE.test(M().norm(text)) ? 100 : 0;
    }
    if (key === 'yearsExperience' && /^\d+(\.\d+)?$/.test(dRaw.trim()) && /\d/.test(text)) {
      return rangeMatches(text, parseFloat(dRaw)) ? 90 : 0;
    }
    const d = canon(dRaw);
    if (a === d || v === d) return 100;
    if (d.length > 2 && (a.startsWith(d) || (a.length > 2 && d.startsWith(a)))) return 80;
    if (d.length > 1 && (a.includes(d) || (v && v.includes(d)))) return 70;
    if (a.length > 3 && d.includes(a)) return 65;
    const ta = new Set(a.split(' ')); const td = d.split(' ');
    const common = td.filter((w) => ta.has(w)).length;
    if (td.length && common / Math.max(td.length, ta.size) >= 0.6) return 60;
    return 0;
  }

  function bestOption(options, candidates, key) {
    let best = -1; let bestScore = 0;
    for (const desired of candidates) {
      options.forEach((o, i) => {
        if (!o.value && !o.text) return;
        const sc = scoreOption(o, desired, key);
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      if (bestScore >= 70) break; // first candidate that works well wins (e.g. +91 before country name)
    }
    return bestScore >= 60 ? best : -1;
  }

  // ---------- per-control fillers ----------
  const isPlaceholderOption = (o) => !o.value || /^(select|choose|please|--|pick)/.test(M().norm(o.text));

  function fillSelect(el, candidates, key, overwrite) {
    const options = Array.from(el.options).map((o) => ({ text: o.text, value: o.value }));
    const cur = options[el.selectedIndex];
    if (!overwrite && cur && !isPlaceholderOption(cur)) return 'already';
    const idx = bestOption(options, candidates, key);
    if (idx < 0) return 'nomatch';
    nativeSet(el, options[idx].value);
    el.selectedIndex = idx;
    fire(el, 'input'); fire(el, 'change');
    return 'filled';
  }

  function fillRadioGroup(el, candidates, key, overwrite) {
    const group = M().groupInputs(el);
    if (!overwrite && group.some((g) => g.checked)) return 'already';
    const options = group.map((g) => ({ text: M().optionLabel(g), value: g.value }));
    const idx = bestOption(options, candidates, key);
    if (idx < 0) return 'nomatch';
    group[idx].click(); // click() makes React/Vue register the change
    if (!group[idx].checked) { group[idx].checked = true; fire(group[idx], 'input'); fire(group[idx], 'change'); }
    return 'filled';
  }

  function fillCheckbox(el, desired, candidates, key, overwrite) {
    const group = M().groupInputs(el);
    if (typeof desired === 'boolean' && group.length === 1) {
      if (el.checked === desired) return overwrite || !desired ? 'filled' : 'already';
      if (el.checked && !overwrite) return 'already';
      el.click();
      return 'filled';
    }
    if (!overwrite && group.some((g) => g.checked)) return 'already';
    const options = group.map((g) => ({ text: M().optionLabel(g), value: g.value }));
    const idx = bestOption(options, candidates, key);
    if (idx < 0) return 'nomatch';
    if (!group[idx].checked) group[idx].click();
    return 'filled';
  }

  const isTextCombobox = (el) => el.tagName === 'INPUT' && (el.getAttribute('role') === 'combobox' ||
    el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('aria-haspopup') === 'listbox');
  const isListboxButton = (el) => el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA' &&
    (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox');

  function visibleOptions(doc) {
    return Array.from(doc.querySelectorAll('[role="option"]'))
      .filter((o) => !hiddenByAncestor(o))
      .map((o) => ({ node: o, text: o.textContent.replace(/\s+/g, ' ').trim(), value: o.getAttribute('data-value') || '' }));
  }

  async function fillCombobox(el, candidates, key) {
    const doc = el.ownerDocument;
    writeText(el, String(candidates[0] || ''));
    await sleep(450);
    const opts = visibleOptions(doc);
    const idx = bestOption(opts, candidates, key);
    if (idx < 0) return 'nomatch';
    clickLike(opts[idx].node);
    return 'filled';
  }

  // Button-style dropdowns (Workday "State", "Country", ...): click open, pick option, fall back to type-ahead.
  const listboxText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const listboxEmpty = (el) => { const t = listboxText(el); return !t || /^(select( one)?|choose|please select|--)/i.test(t) || /select one/i.test(t); };

  async function fillListbox(el, candidates, key, overwrite) {
    const doc = el.ownerDocument;
    if (!overwrite && !listboxEmpty(el)) return 'already';
    try { el.focus(); } catch (e) { /* ignore */ }
    clickLike(el);
    await sleep(350);
    let opts = visibleOptions(doc);
    let idx = bestOption(opts, candidates, key);
    if (idx < 0) {
      const word = String(candidates[0] || '');
      for (const ch of word) { fireKey(el, 'keydown', ch); fireKey(el, 'keypress', ch); fireKey(el, 'keyup', ch); }
      await sleep(350);
      opts = visibleOptions(doc);
      idx = bestOption(opts, candidates, key);
    }
    if (idx < 0) {
      fireKey(el, 'keydown', 'Escape'); // close the popup, leave the field for the user
      return 'nomatch';
    }
    clickLike(opts[idx].node);
    await sleep(150);
    return 'filled';
  }

  // ---------- value resolution ----------
  function resolve(key, answers, el, occurrence) {
    if (key.startsWith('custom:')) {
      const c = answers.customAnswers[parseInt(key.slice(7), 10)];
      return c ? { desired: c.answer, candidates: [c.answer] } : null;
    }
    if (INDEXED.has(key)) {
      const exp = (answers.experience || [])[occurrence] || {};
      let v;
      if (key === 'roleDescription') v = exp.description;
      else if (key === 'currentCompany') v = occurrence === 0 ? (answers.currentCompany || exp.company) : exp.company;
      else v = occurrence === 0 ? (answers.currentTitle || exp.title) : exp.title;
      return v ? { desired: v, candidates: [v] } : null;
    }
    if (key === 'phone' || key === 'phoneInternational') {
      const sigs = (M().textSignals(el).join(' ') + ' ' + (el.getAttribute('placeholder') || '')).toLowerCase();
      const wantsIntl = key === 'phoneInternational' || /country code|international|\+\d/.test(sigs);
      const v = wantsIntl ? answers.phoneInternational : answers.phone;
      return v ? { desired: v, candidates: [v] } : null;
    }
    if (key === 'phoneCountryCode') {
      const c = [answers.phoneCountryCode, answers.country].filter(Boolean);
      return c.length ? { desired: c[0], candidates: c } : null;
    }
    const v = answers[key];
    if (v === null || v === undefined || v === '') return null;
    return { desired: v, candidates: [typeof v === 'boolean' ? v : String(v)] };
  }

  const isRequired = (el) => {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const type = (el.type || '').toLowerCase();
    if (type === 'radio' || type === 'checkbox') {
      // the asterisk lives on the group's legend/question, not on each option label
      const group = M().groupInputs(el);
      if (group.some((g) => g.required || g.getAttribute('aria-required') === 'true')) return true;
      return /\*|\brequired\b/i.test(M().groupQuestion(el));
    }
    return M().labelTexts(el).some((t) => /\*|\brequired\b/i.test(t));
  };

  // ---------- one pass over the page ----------
  async function pass(answers, opts, state) {
    const mapper = M();
    const controls = deepQueryAll(document, CONTROL_SELECTOR);
    const needs = [];
    const needKey = new Set();
    const addNeed = (label, reason) => { const k = label + '|' + reason; if (!needKey.has(k)) { needKey.add(k); needs.push({ label, reason }); } };
    const doneGroups = new Set();
    const occ = {};
    let scanned = 0;
    let changed = 0;

    // Re-apply values that a framework wiped after we wrote them (re-render / controlled input reset).
    if (!opts.dryRun) {
      for (const [el, text] of state.written) {
        if (el.isConnected && !el.isContentEditable && el.value === '' && text) { writeText(el, text); changed++; }
      }
    }

    for (const el of controls) {
      const type = (el.type || '').toLowerCase();
      const listbox = isListboxButton(el);

      if (type === 'file') {
        if (isVisible(el, { skipLayoutCheck: true }) || el.closest('label')) {
          const label = mapper.describe(el);
          if (isRequired(el) || /resume|cv|cover|upload|attach/i.test(label)) {
            addNeed(label || 'File upload', 'Attach the file yourself (browsers do not allow auto-attaching).');
          }
        }
        continue;
      }
      if (!listbox && SKIP_TYPES.has(type)) continue;
      if (!isVisible(el, opts)) continue;
      scanned++;

      const isGroup = type === 'radio' || type === 'checkbox';
      if (isGroup && el.name) {
        const gk = type + ':' + el.name + ':' + (el.form ? 'f' : 'd');
        if (doneGroups.has(gk)) continue;
        doneGroups.add(gk);
      }

      const cls = mapper.classify(el, answers.customAnswers);
      const label = mapper.describe(el);

      if (!cls) {
        const empty = listbox ? listboxEmpty(el) : isGroup ? !mapper.groupInputs(el).some((g) => g.checked) : !el.value;
        if (isRequired(el) && empty) addNeed(label, 'No matching profile field.');
        continue;
      }

      let occurrence = 0;
      if (INDEXED.has(cls.key)) { occurrence = occ[cls.key] = (occ[cls.key] === undefined ? 0 : occ[cls.key] + 1); }

      const r = resolve(cls.key, answers, el, occurrence);
      if (!r) {
        const empty = listbox ? listboxEmpty(el) : isGroup ? !mapper.groupInputs(el).some((g) => g.checked) : !el.value;
        if (isRequired(el) && empty) addNeed(label, 'Your profile has no value for "' + cls.key + '".');
        continue;
      }

      if (opts.dryRun) {
        state.filled.push({ label, key: cls.key, score: cls.score });
        continue;
      }

      let status = 'nomatch';
      let wrote = null;
      try {
        if (el.tagName === 'SELECT') {
          status = fillSelect(el, r.candidates, cls.key, !!opts.overwrite);
        } else if (listbox) {
          status = await fillListbox(el, r.candidates, cls.key, !!opts.overwrite);
          if (status === 'nomatch') addNeed(label, 'Could not pick "' + cls.key + '" from the dropdown; choose it manually.');
        } else if (type === 'radio') {
          status = fillRadioGroup(el, r.candidates, cls.key, !!opts.overwrite);
        } else if (type === 'checkbox') {
          status = fillCheckbox(el, r.desired, r.candidates, cls.key, !!opts.overwrite);
        } else if (isTextCombobox(el)) {
          if (el.value && !opts.overwrite) status = 'already';
          else status = await fillCombobox(el, r.candidates, cls.key);
          if (status === 'nomatch') addNeed(label, 'Typed a value but could not pick it from the dropdown; choose it manually.');
        } else {
          if ((el.isContentEditable ? el.textContent : el.value) && !opts.overwrite) status = 'already';
          else {
            const text = typeof r.desired === 'boolean' ? (r.desired ? 'Yes' : 'No') : String(r.desired);
            if (type === 'number' && !/^-?\d+(\.\d+)?$/.test(text)) status = 'nomatch';
            else { writeText(el, text); status = 'filled'; wrote = text; }
          }
        }
      } catch (e) {
        status = 'error';
      }

      if (status === 'filled') {
        changed++;
        if (wrote !== null) state.written.set(el, wrote);
        if (!state.seen.has(el)) {
          state.seen.add(el);
          state.filled.push({ label, key: cls.key });
        }
        if (opts.highlight !== false && !isGroup && !listbox) highlight(el);
      } else if (status === 'nomatch' && isRequired(el) && !listbox && !isTextCombobox(el)) {
        addNeed(label, 'No option matched your profile value.');
      }
    }
    return { scanned, needs, changed };
  }

  // ---------- main ----------
  async function run(answers, opts) {
    opts = opts || {};
    const state = { filled: [], seen: new WeakSet(), written: new Map() };
    const maxPasses = opts.dryRun ? 1 : (opts.passes || 3);
    let last = { scanned: 0, needs: [], changed: 0 };
    let scanned = 0;
    for (let p = 0; p < maxPasses; p++) {
      last = await pass(answers, { ...opts, overwrite: p === 0 ? !!opts.overwrite : false }, state);
      scanned = Math.max(scanned, last.scanned);
      if (!last.changed) break; // page is stable
      if (p < maxPasses - 1) await sleep(opts.passDelay === undefined ? 700 : opts.passDelay);
    }
    return { fieldsScanned: scanned, filled: state.filled, needsAttention: last.needs, frame: location.href };
  }

  root.__ATSF.run = run;
  root.__ATSF.version = '1.1.0';
})();
