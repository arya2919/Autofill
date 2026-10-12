Tests (no browser needed):
  cd tests && npm install jsdom && cd ..
  node tests/unit.test.mjs   # vault encryption, answers, cover letter
  node tests/fill.test.mjs   # mapper + filler against mock Greenhouse/Lever/Workday forms
