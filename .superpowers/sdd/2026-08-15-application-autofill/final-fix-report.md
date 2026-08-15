# Application Answer Autofill — Final Review Fixes

Branch: `feat/application-autofill`

## FIX A — Prompt caching split duplicated persona + qa_bank

**File:** `backend/api/routes_autofill.py`

### Before

```python
prompt = (template
          .replace("{persona}", persona_txt)
          .replace("{qa_bank}", qa_txt)
          .replace("{company}", company)
          .replace("{position}", position)
          .replace("{question}", question)
          .replace("{max_chars}", str(max_chars)))
# {max_chars} is deliberately NOT substituted here: it must stay out of the
# cached prefix so different length limits reuse the same cache entry
# (only {persona}/{qa_bank}/instructions are stable across requests).
cached_prefix = (template.split("{company}")[0]
                 .replace("{persona}", persona_txt)
                 .replace("{qa_bank}", qa_txt))
...
resp = await call_autofill_llm(prompt, system, max_tokens=max_tokens,
                               cached_prefix=cached_prefix)
```

Bug: `prompt` (the FULL substituted template, including persona + qa_bank)
was passed as arg1 *and* `cached_prefix` (persona + qa_bank again) was also
passed. The Anthropic call sends `[cached_prefix, prompt]`, so persona +
qa_bank reached the model twice — once cached, once at full price. The
`{max_chars}` placeholder was also left un-substituted in `cached_prefix`,
leaving a literal `"{max_chars}"` string in the cached text.

### After

```python
if "{company}" in template:
    before, after = template.split("{company}", 1)
    suffix_template = "{company}" + after
else:
    before, suffix_template = "", template

cached_prefix = (before
                 .replace("{persona}", persona_txt)
                 .replace("{qa_bank}", qa_txt)
                 .replace("{max_chars}", str(max_chars))) or None

suffix = (suffix_template
          .replace("{company}", company)
          .replace("{position}", position)
          .replace("{question}", question)
          .replace("{max_chars}", str(max_chars)))
...
resp = await call_autofill_llm(suffix, system, max_tokens=max_tokens,
                               cached_prefix=cached_prefix)
```

Mirrors `backend/analyzer/cover_letter_generator.py::build_cover_letter_prompt`
/ `generate_cover_letter_body`: cacheable prefix built separately, only the
per-question SUFFIX passed as arg1 to the LLM call, `cached_prefix=` carries
the stable part. The model now sees `[cached_prefix, suffix]`, each field
exactly once. `{max_chars}` is now substituted in both halves — no literal
placeholder remains. (Different `max_chars` values now produce a few distinct
cache entries instead of one; that's an accepted tradeoff — duplication was
the real bug, not cache granularity.)

### Test update — `backend/tests/test_autofill_endpoint.py`

Before:
```python
async def fake(prompt, system, max_tokens=400, cached_prefix=None):
    assert "Rogo" in prompt and "Why fintech?" in prompt  # company + qa_bank present
    return {"text": "Because Rogo is finance and AI.", "usage": {}}
```

After:
```python
async def fake(prompt, system, max_tokens=400, cached_prefix=None):
    # prompt (arg1) is the per-question SUFFIX: company/position/question,
    # but NOT persona/qa_bank (those live only in cached_prefix, once).
    assert "Rogo" in prompt  # company present in suffix
    assert "Why fintech?" in (cached_prefix or "")  # qa_bank present in cached prefix
    assert "Why fintech?" not in prompt  # proves no duplication into the suffix
    return {"text": "Because Rogo is finance and AI.", "usage": {}}
```

Still proves persona/qa_bank reach the model (via `cached_prefix`), and now
additionally proves they reach it exactly once (not duplicated into the
suffix).

## FIX B — "Save to bank" reported success even on error

**File:** `extension/content_autofill.js`

Before:
```javascript
root.getElementById('save').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'autofill_save', question: ctx.question, answer: ta.value });
  root.getElementById('save').textContent = 'Saved';
};
```

After:
```javascript
root.getElementById('save').onclick = async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'autofill_save', question: ctx.question, answer: ta.value });
  const ok = resp && resp.count !== undefined && !resp.error;
  root.getElementById('save').textContent = ok ? 'Saved' : 'Save failed';
};
```

Mirrors the existing `onGenerate` pattern, which distinguishes `resp.answer`
(success) from `resp.error`/no response (failure). The backend
`POST /api/persona/qa-bank` handler (`backend/api/routes_persona.py`) returns
`{"count": len(bank)}` on success; `background.js`'s `autofill_save` relay
returns `{error: ...}` on non-2xx or fetch exceptions — so `resp.count !==
undefined && !resp.error` correctly identifies success.

## Verification

### Backend — autofill tests
```
backend/tests/test_autofill_endpoint.py::test_autofill_returns_answer PASSED
backend/tests/test_autofill_endpoint.py::test_autofill_requires_question PASSED
2 passed, 1 warning in 1.15s
```

### Backend — full suite
```
518 passed, 1 warning in 13.23s
```
No regressions.

### Extension — syntax check
```
$ node --check extension/content_autofill.js
NODE_CHECK_OK  (no output = valid syntax)
```

## Commit

See git log for `fix(autofill): correct prompt caching split + surface save errors`.
