"""LLM helper endpoints — currently the OpenRouter model catalog proxy."""
import time
import logging
import httpx
from fastapi import APIRouter, HTTPException

logger = logging.getLogger("jobnavigator.llm")
router = APIRouter(prefix="/llm", tags=["settings"])

_OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
_CACHE_TTL = 3600  # 1 hour — the catalog changes slowly
_cache = {"at": 0.0, "models": None}


@router.get("/openrouter-models")
async def openrouter_models():
    """Return the OpenRouter model catalog, trimmed to what the Settings picker
    needs. Public endpoint upstream (no OpenRouter key required); cached ~1h so
    opening Settings doesn't hit OpenRouter every time.

    Response: {"models": [{id, name, context_length, prompt_price, completion_price}]}
    """
    now = time.time()
    if _cache["models"] is not None and (now - _cache["at"]) < _CACHE_TTL:
        return {"models": _cache["models"], "cached": True}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(_OPENROUTER_MODELS_URL)
            resp.raise_for_status()
            data = resp.json().get("data", [])
    except Exception as e:
        logger.warning("OpenRouter model fetch failed: %s", e)
        # Serve stale cache rather than nothing if we have it.
        if _cache["models"] is not None:
            return {"models": _cache["models"], "cached": True, "stale": True}
        raise HTTPException(502, "could not reach OpenRouter model catalog")

    models = []
    for m in data:
        pricing = m.get("pricing") or {}
        models.append({
            "id": m.get("id"),
            "name": m.get("name") or m.get("id"),
            "context_length": m.get("context_length"),
            "prompt_price": pricing.get("prompt"),
            "completion_price": pricing.get("completion"),
        })
    models = [m for m in models if m["id"]]
    models.sort(key=lambda m: m["id"])
    _cache["models"] = models
    _cache["at"] = now
    return {"models": models, "cached": False}
