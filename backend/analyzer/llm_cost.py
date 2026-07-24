"""LLM pricing and cost calculation.

Prices in USD per million tokens as of 2026-07. Update PRICING when models change.
Sources: https://www.anthropic.com/pricing, https://openai.com/pricing

Keyed by (provider, model) because the same model name can be billed differently
via different providers — e.g., claude-sonnet-4-6 costs $3/MTok via the Anthropic
API but is covered by the Max/Pro subscription when used via the Claude Code CLI.
"""
from typing import Optional

# Anthropic: cache read = 10% of input, cache write (5m TTL) = 125% of input.
_CLAUDE_FABLE_5 = {
    "input_per_mtok": 10.0,
    "output_per_mtok": 50.0,
    "cache_read_per_mtok": 1.00,
    "cache_write_per_mtok": 12.50,
}
_CLAUDE_OPUS = {  # Opus 5 / 4.8 / 4.7 / 4.6 share the $5/$25 rate card
    "input_per_mtok": 5.0,
    "output_per_mtok": 25.0,
    "cache_read_per_mtok": 0.50,
    "cache_write_per_mtok": 6.25,
}
_CLAUDE_SONNET = {  # Sonnet 5 sticker $3/$15 (intro $2/$10 runs through 2026-08-31)
    "input_per_mtok": 3.0,
    "output_per_mtok": 15.0,
    "cache_read_per_mtok": 0.30,
    "cache_write_per_mtok": 3.75,
}
_CLAUDE_HAIKU = {
    "input_per_mtok": 1.0,
    "output_per_mtok": 5.0,
    "cache_read_per_mtok": 0.10,
    "cache_write_per_mtok": 1.25,
}

# Per million tokens, USD.
PRICING: dict[str, dict[str, dict]] = {
    "claude_api": {
        "claude-fable-5": _CLAUDE_FABLE_5,
        "claude-opus-5": _CLAUDE_OPUS,
        "claude-opus-4-8": _CLAUDE_OPUS,
        "claude-opus-4-7": _CLAUDE_OPUS,
        "claude-opus-4-6": _CLAUDE_OPUS,
        "claude-sonnet-5": _CLAUDE_SONNET,
        "claude-sonnet-4-6": _CLAUDE_SONNET,
        "claude-haiku-4-5": _CLAUDE_HAIKU,
        # Legacy dated ID kept so existing settings/logs still price correctly
        "claude-haiku-4-5-20251001": _CLAUDE_HAIKU,
    },
    "openai": {
        "gpt-4o": {
            "input_per_mtok": 2.50,
            "output_per_mtok": 10.0,
            "cache_read_per_mtok": 2.50,
            "cache_write_per_mtok": 2.50,
        },
        "gpt-4o-mini": {
            "input_per_mtok": 0.15,
            "output_per_mtok": 0.60,
            "cache_read_per_mtok": 0.15,
            "cache_write_per_mtok": 0.15,
        },
    },
}

# Providers whose calls are covered by flat subscription / local compute — always $0.
FREE_PROVIDERS: set[str] = {"claude_code", "ollama"}


def get_pricing(provider: str, model: str) -> Optional[dict]:
    """Return the pricing dict for a (provider, model), or None if unknown."""
    return PRICING.get(provider, {}).get(model)


def calc_cost(provider: str, model: str,
              input_tokens: int = 0,
              output_tokens: int = 0,
              cache_read_tokens: int = 0,
              cache_write_tokens: int = 0) -> float:
    """Calculate USD cost for a single LLM call.

    Returns 0.0 for FREE_PROVIDERS (claude_code subscription, local ollama) or when
    the (provider, model) combo isn't in the pricing table.
    """
    if provider in FREE_PROVIDERS:
        return 0.0
    p = PRICING.get(provider, {}).get(model)
    if not p:
        return 0.0
    return (
        input_tokens * p["input_per_mtok"] / 1_000_000
        + output_tokens * p["output_per_mtok"] / 1_000_000
        + cache_read_tokens * p["cache_read_per_mtok"] / 1_000_000
        + cache_write_tokens * p["cache_write_per_mtok"] / 1_000_000
    )
