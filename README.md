# ATS Autofill

An encrypted, local-first Chrome extension that fills job applications (Workday, Greenhouse, Lever, Ashby and most custom forms) from one master profile. Fill a whole form with one click or a keyboard shortcut, and tailor cover letters to a job description.

**Version 1.1.0** · Manifest V3 · Chrome / Edge / Brave (Chromium 102+) · No server, no account, no tracking.

Your data stays in your browser, encrypted. The only time anything leaves is if you choose the optional AI cover-letter feature, and even then only the fields listed in [section 8](#8-privacy-what-is-and-isnt-sent).

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Tech stack](#2-tech-stack)
3. [Install](#3-install)
4. [First-time setup](#4-first-time-setup)
5. [Daily use](#5-daily-use)
6. [Cover letter tool](#6-cover-letter-tool)
7. [Settings, backup and updating](#7-settings-backup-and-updating)
8. [Privacy: what is and isn't sent](#8-privacy-what-is-and-isnt-sent)
9. [How it works (architecture)](#9-how-it-works-architecture)
10. [Security model](#10-security-model)
11. [Troubleshooting](#11-troubleshooting)
12. [Known limitations](#12-known-limitations)
13. [Customising and developing](#13-customising-and-developing)
14. [Changelog](#14-changelog)
15. [Ideas for next steps](#15-ideas-for-next-steps)

---

## 1. What it does

| Feature | Details |
|---|---|
| **Smart field mapping** | Matches form fields to your profile using regular expressions and attributes (`autocomplete`, `name`, `id`, `data-automation-id`, label text, `aria-label`, placeholder, surrounding question text). Works across different ATS designs. |
| **Encrypted local storage** | Profile, API key and cover-letter draft are encrypted with AES-256-GCM and stored in `chrome.storage.local`. A master password unlocks them. |
| **One-click / shortcut fill** | Press **Alt+Shift+F** (Option+Shift+F on Mac) or click **Autofill this page**. |
| **Handles real-world widgets** | Text inputs, `<select>`, radio groups, checkboxes, typeahead boxes (react-select), button-style dropdowns (Workday), contenteditable, open shadow DOM, framework-controlled inputs (React/Angular/Vue). |
| **Multi-pass filling** | Fills in several passes so fields that appear or get re-rendered after earlier answers (e.g. State / Postal Code after choosing a Country) are still filled. |
| **Work history blocks** | Repeated "Job Title / Company / Role Description" sections are filled job by job from your saved work history. |
| **Cover letter tool** | Paste a job description. Get a keyword-match score, missing keywords, your most relevant achievements, and a drafted letter, offline or via an AI model. |
| **Custom answers** | Your own regex → answer rules (pronouns, "why do you want to work here", etc.). |
| **Safe by design** | Never clicks Submit, never ticks consent checkboxes, skips password / hidden / honeypot / disabled / read-only fields, never guesses Yes/No eligibility answers you left blank. |

## 2. Tech stack

| Layer | Technology |
|---|---|
| Platform | Chrome Extension, **Manifest V3** |
| Language | Vanilla JavaScript (ES modules, ES2022), HTML5, CSS3. **No framework, no bundler, no build step.** |
| Popup UI | Vanilla JS + hand-written CSS (automatic light/dark mode via `prefers-color-scheme`) |
| Background | **MV3 service worker** (module type) |
| Page code | **Content scripts injected on demand** with `chrome.scripting.executeScript` (no always-on scripts; runs only when you fill) |
| Storage | `chrome.storage.local` (encrypted vault), `chrome.storage.session` (in-memory unlock key) |
| Auto-lock | `chrome.alarms` |
| Shortcut | `chrome.commands` |
| Encryption | **Web Crypto API**: PBKDF2-HMAC-SHA256 (600,000 iterations) → AES-256-GCM, 96-bit random IV per save, authenticated (AAD) |
| Optional AI | `fetch` to the Anthropic Messages API, or any OpenAI-compatible endpoint (Ollama, LM Studio, etc.); host access requested at runtime with `chrome.permissions` |
| Tests | **Node.js 20+**, `node:assert`, **jsdom** (simulated Greenhouse / Lever / Workday-style pages), mocked `chrome.*` APIs |
| Icons | Generated with Python **Pillow** |

Roughly 1,800 lines of code in total (the mapper alone defines 46 field types).

## 3. Install

Takes about two minutes.

1. **Unzip** `ats-autofill.zip` to a folder you will keep. Chrome loads the extension from that folder, so don't delete or move it later.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle at the top-right).
4. Click **Load unpacked** (top-left).
5. Select the folder that contains `manifest.json` directly inside it. If unzipping created a folder inside a folder, pick the inner one.
6. "ATS Autofill" appears as a card. If it shows a red **Errors** button, click it and note the message (see [Troubleshooting](#11-troubleshooting)).
7. Click the **puzzle-piece** icon in the toolbar, then the **pin** next to ATS Autofill.

**Tip:** if you also use other autofill extensions (Jobright, Simplify, etc.), switch them off while using this one. Two extensions filling the same form will overwrite each other.

## 4. First-time setup

### 4.1 Create your master password

Click the extension icon, choose a master password (8+ characters), confirm it, and click **Create encrypted vault**.

> **There is no password recovery.** The password is never stored, so if you forget it your data cannot be decrypted. Do step 4.4 (backup) right away.

### 4.2 Fill in your profile

Open the **Profile** tab. Fill in what you want; **blank fields are never entered anywhere.**

| Section | Notes |
|---|---|
| Personal | Name, email, phone. Enter the country code (`+91`) and the number separately. The extension combines them when a form asks for "phone including country code". |
| Address | Lines 1–3, city, state, PIN/ZIP, country. Use the full names forms show (e.g. `India`, `Gujarat`). |
| Links | LinkedIn, GitHub, portfolio, website, Twitter/X. A generic "URL" field gets website → portfolio → LinkedIn → GitHub, in that order. |
| Work | Current company/title, total years of experience, notice period, current and expected salary, start date. |
| Education | University, degree, field of study, graduation year, GPA. |
| Eligibility questions | Authorized to work, needs visa sponsorship, willing to relocate, **ever worked for the company applied to**. Each is **Yes / No / don't fill**. Leave "don't fill" for any you would rather answer yourself per application. |
| Voluntary self-identification | Gender, ethnicity, veteran, disability. Empty = never filled. Type `decline` to pick the "Decline to self-identify" option. |
| About you | Professional summary and skills (comma separated). Skills drive the cover-letter keyword match. |

Click **Save profile**.

### 4.3 Add work history and custom answers (Advanced)

Open **Advanced: work history & custom answers** at the bottom of the Profile tab. Click **Insert example**, then replace it with your real data:

```json
{
  "experience": [
    {
      "company": "Acme Corp",
      "title": "Software Engineer",
      "start": "2022-06",
      "end": "Present",
      "bullets": [
        "Reduced API p95 latency by 40% by adding Redis caching in Node.js services",
        "Led migration of a monolith to microservices on AWS"
      ]
    },
    {
      "company": "Globex",
      "title": "Intern",
      "bullets": ["Wrote integration tests for the billing service"]
    }
  ],
  "customAnswers": [
    { "match": "pronouns?", "answer": "he/him" },
    { "match": "why (do you want|are you interested)", "answer": "I'm excited by the product and the engineering culture." }
  ]
}
```

- **`experience`** (newest first) feeds the cover-letter tailoring and fills repeated work-history blocks on application forms: the first block gets job 1, the second job 2, and so on. Bullets become the "Role Description".
- **`customAnswers`**: `match` is a case-insensitive **regular expression** tested against each field's label, name, id and placeholder. Custom answers **win over** the built-in mapping. Invalid regexes are rejected when you save.

Click **Save profile** again.

### 4.4 Download a backup

**Settings → Download encrypted backup** (or **Copy backup**). Keep the file somewhere safe. It is encrypted, so it is useless without your password.

## 5. Daily use

1. Open a job application page. On Workday, sign in or create the account first.
2. Press **Alt+Shift+F** (Mac: **⌥⇧F**), or click the icon → **Autofill this page**.
3. Filled fields get a brief green outline. A toast on the page and the popup list **what was filled** and **what needs your attention**.
4. Fix anything under "Needs your attention" (file uploads, unknown questions, dropdowns it couldn't pick).
5. **Review the whole form, then submit it yourself.** The extension never clicks Submit.

**Multi-step forms (Workday, etc.):** run the fill again on each page or step. If an "Add" button reveals new fields (Work Experience, Websites), click **Add** first, then fill.

**Options in the popup:**
- *Overwrite fields that already have a value*: off by default, so anything you typed or the site pre-filled is left alone.

**Change the shortcut:** `chrome://extensions/shortcuts`.

**Vault locked?** The page toast says so. Click the icon and enter your password. The vault auto-locks after 60 minutes (configurable) and whenever the browser closes.

### What gets filled, and what never does

| Filled | Never filled |
|---|---|
| Name, email, phone, address, links | Password fields |
| Work, education, notice period, salary | Search boxes |
| Yes/No eligibility (only if you set them) | Consent / terms / privacy checkboxes |
| Referral source, EEO (only if you set them) | Hidden, disabled, read-only fields and off-screen honeypots |
| Cover letter text (if you saved one) | File uploads (browsers don't allow it; they're listed for you) |
| Custom answers | Fields your profile has no value for |

## 6. Cover letter tool

Open the **Cover letter** tab.

1. Enter company, role and (optionally) the hiring manager's name. Paste the job description.
2. **Generate (local)** (works offline):
   - ranks your experience bullets by relevance to the job,
   - shows a **keyword-match %**, the skills that matched, and **keywords the job wants that your profile lacks** (add them to your profile only if they are true),
   - drafts a letter from a template.
3. Edit the draft freely. **Copy** it, or click **Use for autofill** to store it encrypted. It is then inserted into any "Cover letter" text box on your next fill.

### Optional: generate with AI

**Settings → AI cover letters**:

| Provider | Setup |
|---|---|
| **Anthropic (Claude API)** | Paste your own API key and a model name. Chrome asks permission for `api.anthropic.com` the first time. |
| **OpenAI-compatible / local** | Set the base URL and model. Examples: Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`. Ollama may need `OLLAMA_ORIGINS=chrome-extension://*` set. API key can be empty for local servers. |

The API key is stored inside the encrypted vault. The AI mode has not been tested against live APIs, so if it fails, the error message is shown in the popup; the local generator always works.

## 7. Settings, backup and updating

| Setting | What it does |
|---|---|
| Auto-lock | Minutes of inactivity before the vault locks (0 = only when the browser closes). |
| Change master password | Re-encrypts the vault with a new password. |
| Download / Copy encrypted backup | Exports the still-encrypted vault. |
| Import backup | Replaces the current vault; you then unlock it with *that* backup's password. |
| Allow embedded forms | Grants access to all HTTPS sites so forms embedded in an iframe on a company's own website can be filled. Optional. |
| Erase everything | Deletes the vault and settings from this browser. Backups you exported still work. |

### Updating to a new version

1. Unzip the new zip.
2. Copy its contents **over the same folder you originally loaded** (replace all files). **Don't load a different folder:** Chrome stores your encrypted data per extension ID, which comes from the folder, so a new folder looks like an empty extension. If that happens, load the old folder again or restore your backup.
3. Go to `chrome://extensions` and click the circular **reload** arrow on the ATS Autofill card. Your profile stays as it is.

### Moving to another computer

Download a backup on the old one → install the extension on the new one → on the setup screen open **Restore from an encrypted backup**, paste the backup text, then unlock with the old password.

## 8. Privacy: what is and isn't sent

- **No analytics, no telemetry, no servers of ours.** There is no backend.
- Your profile never leaves the browser, except as follows.
- **If you use "Generate with AI"**, the request to your chosen provider contains only: name, current title and company, years of experience, summary, skills, your most relevant bullets, matched skills, and the job description. **Email, phone, address, and eligibility / self-identification answers are never sent.**
- Permissions requested and why:

| Permission | Why |
|---|---|
| `storage` | Save the encrypted vault and the in-memory unlock key. |
| `activeTab` | Fill the page you're on, only when you trigger it. |
| `scripting` | Inject the fill scripts into that page on demand. |
| `alarms` | Auto-lock timer. |
| Optional hosts | Only requested if you use AI (that API host) or enable embedded forms. |

The extension has no always-on content scripts and no access to sites until you trigger a fill.

## 9. How it works (architecture)

```
ats-autofill/
├── manifest.json                 MV3 manifest, permissions, shortcut
├── background/
│   └── service-worker.js         shortcut handler, auto-lock alarm, injects scripts,
│                                 collects results, shows toast/badge
├── content/
│   ├── mapper.js                 field classification: regex + attribute scoring
│   └── filler.js                 writes values; selects, radios, listboxes, shadow DOM;
│                                 multi-pass loop
├── lib/
│   ├── vault.js                  PBKDF2 → AES-GCM vault, lock/unlock, backup, wipe
│   ├── answers.js                flattens your profile into the answers the filler uses
│   ├── coverletter.js            offline JD analysis, bullet ranking, letter draft
│   └── ai.js                     optional Claude / OpenAI-compatible / local LLM call
├── popup/
│   ├── popup.html / .css / .js   UI: Fill, Profile, Cover letter, Settings
│   └── schema.js                 declarative description of the Profile form
├── icons/                        16/32/48/128 px
└── tests/                        unit + mock-ATS tests
```

### Fill flow

```
Alt+Shift+F  ──►  service worker
                    │ 1. read encrypted vault, decrypt with key from storage.session
                    │ 2. buildAnswers(profile)            (lib/answers.js)
                    │ 3. inject mapper.js + filler.js into every frame
                    ▼
               content script (in the page)
                    │ 4. find all controls (incl. shadow DOM)
                    │ 5. mapper.classify(control) → which answer belongs here
                    │ 6. filler writes value + fires input/change events
                    │ 7. repeat up to 3 passes until the page is stable
                    ▼
               results (labels only, never values) ──► toast + popup list
```

### The mapper: how a field is identified

Each control is scored from these signals, strongest first:

1. **Your custom answers** (regex)
2. Standard HTML **`autocomplete`** attribute (`given-name`, `email`, `postal-code`, …)
3. **`type=email` / `tel`**
4. **Attributes**: `name`, `id`, `data-automation-id`, `data-qa`, `data-testid`, `formcontrolname`, …
5. **Label text** (`<label for>`, wrapping label, `aria-labelledby`)
6. **`aria-label`** and **placeholder**
7. For radio/checkbox groups: the **legend or surrounding question text**
8. If nothing else: the nearest preceding text

Each field type (`firstName`, `postalCode`, `previousEmployee`, …) has positive patterns and **negative patterns** so "Company name", "Name of your reference" or "Role Description" aren't mistaken for your name or years of experience. Long question-style labels can only match field types that are marked as questions. A control must score at least 50 to be filled.

### The filler: writing values so websites notice

- Uses the **native value setter** and dispatches `input` + `change` events so React, Angular and Vue update their internal state (plain `el.value = x` is silently ignored by controlled inputs).
- **Selects**: best-option scoring with exact / prefix / contains / word-overlap, country aliases (USA → United States), phone codes (`India (+91)`), and numeric ranges ("4-6 years", "7+ years") for years of experience.
- **Radios**: matches the option text ("Yes"/"No") against your boolean.
- **Typeahead and button dropdowns**: types or clicks, waits for `role="option"` items, clicks the best match.
- **Re-fill**: if a framework wipes a value right after it was written, the next pass re-applies it.

## 10. Security model

- **Key derivation:** PBKDF2-HMAC-SHA256, 600,000 iterations, random 16-byte salt.
- **Encryption:** AES-256-GCM, fresh random 12-byte IV on every save, additional authenticated data binds ciphertext to this app. Any tampering fails authentication and locks the vault.
- **At rest:** only `{salt, iv, ciphertext}` is written to `chrome.storage.local`. Nothing readable (name, email, API key) is stored in plain text. This is verified by the unit tests.
- **While unlocked:** the derived key is kept in `chrome.storage.session`, which is memory-only, never written to disk, cleared when the browser closes, and not accessible to web pages or content scripts.
- **Auto-lock:** timer via `chrome.alarms`, default 60 minutes.

**Honest limits.** This protects your data *at rest*: someone browsing your Chrome profile files, a stolen or imaged disk. It does **not** protect against malware already running as you, a malicious extension with broad permissions, or someone using your unlocked browser. Use a strong master password and lock the vault on shared machines.

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| Red **Errors** on the extension card | Click it and read the message. Usually a wrong folder was loaded: re-load the folder that contains `manifest.json` directly. |
| Popup is blank or stuck | Right-click the popup → **Inspect** → Console, and read the error. |
| Shortcut does nothing | Another app or extension may own Alt+Shift+F. Change it at `chrome://extensions/shortcuts`. |
| "Locked" toast | Click the icon and enter your master password. |
| "Can't run on this page" | Chrome blocks extensions on `chrome://` pages and the Chrome Web Store. Use a normal website. |
| "No form fields found" | The form may be inside an iframe: **Settings → Allow embedded forms**. Or the form hasn't loaded yet; wait and retry. |
| Required field still errors after fill (e.g. "Postal Code is required") | Check that field is filled in your Profile. Run the fill again (later steps and re-renders are handled on each run). Check the "Needs your attention" list. |
| A dropdown isn't picked | The site's wording differs from yours. Use the site's exact wording in your profile (e.g. `Bachelor's Degree`), or pick it manually. |
| A field is filled wrongly or missed | Add a custom answer with a regex for its label, or send me the field's label and what it should map to. |
| Two autofill extensions fight | Disable the other one while using this. |
| Data disappeared after an update | You loaded a different folder. Load the original folder or import your backup. |
| Forgot master password | Not recoverable. Erase everything in Settings (or via a fresh install) and restore a backup only if you remember *that backup's* password. |

**Debugging a fill:** open `chrome://extensions` → **service worker** link on the card to see background logs. For a page-level view, open DevTools on the application page.

## 12. Known limitations

- **File uploads** (resume, cover letter PDF) can't be attached by any extension. They are listed so you do it by hand.
- **Workday**: normal inputs, selects, radio groups and button-style dropdowns are handled. Some custom widgets (calendar date pickers, multi-select skill pickers, "My Experience" resume parsing) are not. Optional fields such as "Local Given Name(s)", "Phone Extension" and "Address Line 3" are only filled if you give them values.
- **Typeahead boxes** such as "How did you hear about us?" may need you to type and choose from the list.
- **Date pickers** are skipped.
- **Repeating blocks** (work history, education, languages) are filled only where the blocks already exist on the page. Click the site's **Add** button first.
- **Closed shadow DOM** and cross-origin iframes (without the embedded-forms permission) can't be read.
- **Layout changes:** sites change their markup. Add a custom answer, or edit the patterns in `content/mapper.js`.
- Tested on **simulated** pages in Node/jsdom, not against every live ATS. Expect to tune the mapper after your first several real applications.
- Terms of service of some employers restrict automated form filling; you are responsible for reviewing what is submitted.

## 13. Customising and developing

### Run the tests

No browser needed. Requires Node.js 20+.

```bash
cd ats-autofill
cd tests && npm init -y && npm install jsdom && cd ..
node tests/unit.test.mjs    # vault encryption, answers, cover letter
node tests/fill.test.mjs    # mapper + filler on mock Greenhouse / Lever / Workday-style pages
```

The tests cover: encryption at rest and tamper detection, password change, backup round-trip, field mapping on Greenhouse/Lever/Workday-style forms, radios/selects/ranges, safety rules (honeypots, consent boxes, readonly), React-style controlled inputs, typeahead dropdowns, shadow DOM, Workday country → State/Postal Code re-render, and repeated work-history blocks.

### Edit and reload

After changing any file, go to `chrome://extensions` and click the **reload** arrow on the card. To debug:
- **Popup**: right-click the popup → Inspect.
- **Background**: click the **service worker** link on the card.
- **Page**: normal DevTools on the application page.

### Add or fix a field mapping

Open `content/mapper.js` and add an entry to `DEFS`:

```js
D('noticePeriod',                        // key, must exist in lib/answers.js
  [/\bnotice ?period\b/],                // patterns tested against labels AND attributes
  { not: [/something to exclude/],       // ignore a signal if this matches
    attrPatterns: [/^notice$/],          // patterns tested only against name/id/data-*
    kind: 'bool',                        // for Yes/No answers
    question: true,                      // allowed to match long question-style labels
    textOnly: true })                    // only for <textarea>/contenteditable
```

Then: add the answer in `lib/answers.js`, add a form field in `popup/schema.js` and the default in `lib/vault.js`, and add a test in `tests/fill.test.mjs`.

**Quick fix without code:** use a custom answer in the Profile → Advanced JSON.

### Dry run

In tests you can call `__ATSF.run(answers, { dryRun: true })` to see what *would* be filled without changing the page.

## 14. Changelog

- **1.1.0**: repeat passes so fields re-rendered after choosing a country (State, Postal Code) are filled; button-style dropdowns (Workday State/Country); "Have you ever worked for this company?" answer; Address Line 3; work-history blocks (Job Title, Company, Role Description) filled per job; generic "URL" fields; fixed "Role Description" being mistaken for years of experience; required radio questions are reported when your profile has no answer.
- **1.0.0**: first release.

## 15. Ideas for next steps

- Per-site profile overrides (different phone or email per employer).
- An application tracker (company, role, date, link, status) in the same encrypted vault.
- A "learn this field" button: click an unmatched field and save its label as a mapping.
- Auto-add repeating work-history and education blocks for specific ATSs.
- Export/import profile from a resume (PDF/JSON Resume).
- Publish to the Chrome Web Store (needs a store listing, privacy policy and a one-time developer fee).

## Licence

Personal-use project. Add a licence of your choice (e.g. MIT) before sharing publicly.
