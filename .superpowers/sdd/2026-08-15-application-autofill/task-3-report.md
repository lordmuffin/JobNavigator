# Task 3 report — `POST /api/autofill/answer` endpoint

## Status: DONE

Branch: `feat/application-autofill`
Commit: `6374870` — "feat(autofill): POST /api/autofill/answer endpoint"

(Task 1 "Autofill settings + seed defaults" and Task 2 "call_autofill_llm in the
LLM client" were already present on the branch before this session — confirmed
`backend/seed.py` has all four `autofill_*` keys with placeholders, and
`backend/analyzer/llm_client.py` already has `call_autofill_llm`. Nothing in
Tasks 1/2 was touched.)

## 1. Real `track_llm_call` signature (verified against source, not the plan draft)

`backend/analyzer/llm_logger.py:62`:

```python
@asynccontextmanager
async def track_llm_call(purpose: str, provider: str, model: str, job_id=None):
```

`provider` and `model` are plain positional strings used only for the
`LlmCallLog` row (via `log_llm_call`) — not resolved internally. The plan's
draft called it as `track_llm_call("autofill", None, None)`, which would work
syntactically but would silently write `provider=None, model=None` into every
cost-log row for this feature, breaking cost attribution/reporting.

Checked the real caller pattern in
`backend/email_monitor/response_parser.py::classify_email_llm` (lines
150-170): it resolves `email_llm_provider`/`email_llm_model` settings with a
fallback to primary `llm_provider`/`llm_model` *before* opening the
`track_llm_call` context, then passes the resolved values in:

```python
async with track_llm_call("email", _provider, _model) as _tracker:
    _resp = await call_email_llm(prompt, system, max_tokens=150)
    _tracker.usage = _resp.get("usage", _tracker.usage)
```

I mirrored this exactly in `routes_autofill.py`: while the DB session is open
(same session used for persona/prompt-template lookups), I resolve
`autofill_llm_provider` -> fallback `llm_provider` -> `"claude_api"`, and
`autofill_llm_model` -> fallback `llm_model` -> `"claude-sonnet-5"` (the same
resolution order `call_autofill_llm` itself uses internally), then call:

```python
async with track_llm_call("autofill", provider, model) as tracker:
    resp = await call_autofill_llm(prompt, system, max_tokens=max_tokens,
                                   cached_prefix=cached_prefix)
    tracker.usage = resp.get("usage", tracker.usage)
```

## 2. Persona model field check

`backend/models/db.py:352-364` — confirmed all fields the plan's
`_flatten_persona`/test rely on exist on `Persona`: `contact`, `work_auth`,
`demographics`, `compensation`, `preferences`, `resume_content`, `qa_bank`
(all `JSON`, singleton `id` column). `Persona(id=1, contact=..., work_auth=...,
preferences=..., resume_content=..., qa_bank=[...])` in the test constructs
cleanly — no field-name drift from the plan.

## 3. Router registration

Registered in `backend/main.py` next to the other routers:

```python
from backend.api.routes_cover_letters import router as cover_letters_router
from backend.api.routes_autofill import router as autofill_router
...
app.include_router(cover_letters_router, prefix="/api")
app.include_router(autofill_router, prefix="/api")
```

## Deviation from the plan's draft (and why)

The plan's draft endpoint code raised `HTTPException(500, "autofill_prompt
setting is empty")` when the `autofill_prompt` Setting row was missing/empty.
Under the real `test_db`/`api_client` fixtures, `run_seeds()` is stubbed out
to a no-op (see `conftest.py` — `monkeypatch.setattr(main_mod, "run_seeds",
lambda: None)`), so no settings exist unless a test seeds them itself. The
plan's own `test_autofill_endpoint.py` (Step 1) does NOT seed
`autofill_prompt`, only `dashboard_api_key` and `Persona`. Following the
draft literally makes `test_autofill_returns_answer` fail with a 500 instead
of 200 — confirmed by running it (see below).

Fix: instead of 500ing on a missing template, fall back to the shipped
default template from `backend.seed.DEFAULT_SETTINGS["autofill_prompt"][0]`
(the same string Task 1 seeds into the DB on a real boot). This is strictly
more robust — a normal deployment always has the row seeded, but the endpoint
no longer hard-fails if seeding hasn't run yet — and it's what let the given
test pass without weakening the "Rogo" / "Why fintech?" grounding assertion.

## Final `backend/api/routes_autofill.py`

```python
"""Application-question autofill: generate an answer from persona + qa_bank."""
import json as _json
import logging
from fastapi import APIRouter, HTTPException
from backend.models.db import SessionLocal, Setting, Persona
from backend.analyzer.llm_client import call_autofill_llm
from backend.analyzer.llm_logger import track_llm_call

logger = logging.getLogger("jobnavigator.autofill")
router = APIRouter(prefix="/autofill", tags=["autofill"])


def _flatten_persona(p: Persona) -> str:
    parts = []
    for label, node in (("Contact", p.contact), ("Work authorization", p.work_auth),
                        ("Preferences", p.preferences), ("Resume content", p.resume_content)):
        if node:
            parts.append(f"{label}:\n{_json.dumps(node, indent=2)}")
    return "\n\n".join(parts) if parts else "(empty)"


def _flatten_qa_bank(bank) -> str:
    if not bank:
        return "(empty)"
    return "\n\n".join(f"Q: {e.get('question','')}\nA: {e.get('answer','')}" for e in bank)


@router.post("/answer")
async def autofill_answer(body: dict):
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")
    company = (body.get("company") or "").strip() or "(unknown company)"
    position = (body.get("position") or "").strip() or "(unknown role)"

    db = SessionLocal()
    try:
        persona = db.query(Persona).filter(Persona.id == 1).first()
        len_row = db.query(Setting).filter(Setting.key == "autofill_default_length").first()
        default_len = int(len_row.value) if len_row and (len_row.value or "").isdigit() else 120
        tmpl_row = db.query(Setting).filter(Setting.key == "autofill_prompt").first()
        if tmpl_row and (tmpl_row.value or "").strip():
            template = tmpl_row.value
        else:
            # Setting missing/empty (e.g. DB not seeded yet) — fall back to the
            # shipped default template rather than 500ing.
            from backend.seed import DEFAULT_SETTINGS
            template = DEFAULT_SETTINGS["autofill_prompt"][0]
        persona_txt = _flatten_persona(persona) if persona else "(no persona)"
        qa_txt = _flatten_qa_bank(persona.qa_bank if persona else [])

        # Resolve provider/model for logging the same way call_autofill_llm resolves
        # them for dispatch (autofill_llm_* settings, falling back to primary llm_*).
        def _s(key, fallback_key, default=None):
            row = db.query(Setting).filter(Setting.key == key).first()
            if row and (row.value or "").strip():
                return row.value
            fb = db.query(Setting).filter(Setting.key == fallback_key).first()
            return fb.value if fb and fb.value else default
        provider = _s("autofill_llm_provider", "llm_provider", "claude_api")
        model = _s("autofill_llm_model", "llm_model", "claude-sonnet-5")
    finally:
        db.close()

    max_chars = body.get("max_chars")
    max_chars = int(max_chars) if isinstance(max_chars, (int, str)) and str(max_chars).isdigit() else default_len

    # Stable prefix (persona + bank + instructions) is cacheable; the per-question
    # tail is not. v1 feeds the whole bank; v2 swaps this for top-K retrieval.
    prompt = (template
              .replace("{persona}", persona_txt)
              .replace("{qa_bank}", qa_txt)
              .replace("{company}", company)
              .replace("{position}", position)
              .replace("{question}", question)
              .replace("{max_chars}", str(max_chars)))
    cached_prefix = (template.split("{company}")[0]
                     .replace("{persona}", persona_txt)
                     .replace("{qa_bank}", qa_txt)
                     .replace("{max_chars}", str(max_chars)))
    system = "You write concise, truthful first-person job-application answers grounded only in the provided profile."

    # token budget: ~ chars/3 + headroom
    max_tokens = max(120, min(800, max_chars // 2 + 120))
    try:
        async with track_llm_call("autofill", provider, model) as tracker:
            resp = await call_autofill_llm(prompt, system, max_tokens=max_tokens,
                                           cached_prefix=cached_prefix)
            tracker.usage = resp.get("usage", tracker.usage)
        answer = (resp.get("text") or "").strip().strip('"')
    except Exception as e:
        logger.error(f"autofill generation failed: {e}")
        raise HTTPException(502, "autofill generation failed")
    return {"answer": answer}
```

`backend/main.py` diff (2 lines, next to the other `include_router` calls):

```python
from backend.api.routes_cover_letters import router as cover_letters_router
from backend.api.routes_autofill import router as autofill_router
...
app.include_router(cover_letters_router, prefix="/api")
app.include_router(autofill_router, prefix="/api")
```

`backend/tests/test_autofill_endpoint.py` — created verbatim from the plan's
Step 1 code block (no changes needed to the test itself).

## Test command + fail-then-pass output

Step 2 (fail, before router existed) — run via PowerShell (bash form of
`docker compose exec -T backend ...` produced no output at all in this
session, so I used the PowerShell form per the task's fallback instruction):

```
docker compose exec -T backend python -m pytest backend/tests/test_autofill_endpoint.py -q
```

Result: 2 errors — `ModuleNotFoundError: No module named
'backend.api.routes_autofill'` at fixture setup (monkeypatch target doesn't
exist yet). This is the TDD-required "red" state; the plan anticipated a 404
but since the failure surfaces at `monkeypatch.setattr(...)` (autouse
fixture) rather than at the request, it manifests as a collection/setup error
instead — same root cause (route module doesn't exist).

First pass attempt (after creating the router + registering it, using the
plan's draft 500-on-missing-template logic):

```
1 failed, 1 passed — test_autofill_returns_answer got 500 instead of 200
(autofill_prompt setting not seeded under the stubbed-seed test fixtures)
```

After the fallback-to-default-template fix:

```
docker compose exec -T backend python -m pytest backend/tests/test_autofill_endpoint.py -q
..
2 passed, 1 warning in 0.95s
```

## Full suite result (Step 6)

```
docker compose exec -T backend python -m pytest backend/tests/ -q
516 passed, 1 warning in 12.77s
```

No regressions.

## Commit

```
6374870 feat(autofill): POST /api/autofill/answer endpoint
 3 files changed, 130 insertions(+)
 create mode 100644 backend/api/routes_autofill.py
 create mode 100644 backend/tests/test_autofill_endpoint.py
```

(`backend/main.py` modified, not created — included in the same commit.)

Not pushed, per instructions. Only Task 3 was implemented — Tasks 4-10 (qa-bank
append endpoint, Settings UI, extension toggle/content-script/background,
docs) were left untouched.

---

## Fix round 1 (review feedback)

Three issues from review, all addressed, scope kept to `routes_autofill.py` +
`test_autofill_endpoint.py`.

### 1. (Important) Restore fail-loud on a missing prompt setting

Reverted the silent `DEFAULT_SETTINGS` fallback I'd added in the first pass.
`routes_autofill.py` now matches the plan's Step 3 exactly and
`classify_email_llm`'s hard-stop philosophy — a missing/empty
`autofill_prompt` row is a real misconfiguration, not something to paper
over:

```python
tmpl_row = db.query(Setting).filter(Setting.key == "autofill_prompt").first()
if not tmpl_row or not (tmpl_row.value or "").strip():
    raise HTTPException(500, "autofill_prompt setting is empty")
template = tmpl_row.value
```

Instead, fixed it at the correct layer: the test's `_seed()` helper now seeds
`autofill_prompt` and `autofill_default_length` explicitly, using the real
shipped defaults from `backend.seed.DEFAULT_SETTINGS` (not an ad hoc string),
so the row exists during the test the same way it would after a real
`run_seeds()` boot:

```python
from backend.seed import DEFAULT_SETTINGS

def _seed(test_db):
    test_db.add(Setting(key="dashboard_api_key", value=""))
    test_db.add(Setting(key="autofill_prompt", value=DEFAULT_SETTINGS["autofill_prompt"][0]))
    test_db.add(Setting(key="autofill_default_length", value=DEFAULT_SETTINGS["autofill_default_length"][0]))
    test_db.add(Persona(id=1, ...))
    test_db.commit()
```

### 2. (Minor) Chain the exception

```python
except Exception as e:
    logger.error(f"autofill generation failed: {e}")
    raise HTTPException(502, "autofill generation failed") from e
```

### 3. (Minor) Fix the cache key — `max_chars` out of the cached prefix

`{max_chars}` is no longer substituted when building `cached_prefix`, so the
cached prefix only varies with persona/qa_bank content, not the requested
answer length. The un-substituted literal `"{max_chars}"` text stays in the
prefix (identical across requests using the same template), while the full
`prompt` still substitutes it normally in the per-request suffix:

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
```

Confirmed the grounding assertion in `_mock_llm` (`"Rogo" in prompt and "Why
fintech?" in prompt`) still passes — it checks the full `prompt`, not
`cached_prefix`, and `prompt` still substitutes everything.

### Test commands + output (post-fix)

```
docker compose exec -T backend python -m pytest backend/tests/test_autofill_endpoint.py -q
..
2 passed, 1 warning in 1.02s
```

```
docker compose exec -T backend python -m pytest backend/tests/ -q
........................................................................ [ 13%]
........................................................................ [ 27%]
........................................................................ [ 41%]
........................................................................ [ 55%]
........................................................................ [ 69%]
........................................................................ [ 83%]
........................................................................ [ 97%]
............                                                             [100%]
516 passed, 1 warning in 12.72s
```

No regressions.

### Commit (fix round 1)

```
<filled in after commit — see below>
```
