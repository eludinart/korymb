"""Estimation heuristique coût mission avant lancement."""
from __future__ import annotations

from runtime_settings import merge_with_env


def estimate_mission_cost(
    *,
    mission: str,
    agents: list[str] | None = None,
    mode: str = "cio",
    refinement_rounds: int = 0,
    tools: list[str] | None = None,
) -> dict:
    cfg = merge_with_env()
    price_in = float(cfg.get("llm_price_input_per_million_usd") or 0.15)
    price_out = float(cfg.get("llm_price_output_per_million_usd") or 0.6)
    text_len = len((mission or "").strip())
    agent_count = max(1, len(agents or ["coordinateur"]))
    mode_mult = {"triad": 2.8, "langgraph": 1.4, "cio": 1.0}.get(str(mode or "cio").lower(), 1.0)
    tool_mult = 1.0 + 0.15 * len(tools or [])
    base_tokens = int((800 + text_len * 1.2 + agent_count * 1200) * mode_mult * tool_mult)
    refinement_tokens = int(refinement_rounds) * int(base_tokens * 0.35)
    estimated_tokens = base_tokens + refinement_tokens
    est_in = int(estimated_tokens * 0.55)
    est_out = int(estimated_tokens * 0.45)
    cost_usd = round((est_in * price_in + est_out * price_out) / 1_000_000, 4)
    tier = "economy" if estimated_tokens < 8000 else ("research" if estimated_tokens > 40000 else "standard")
    warnings: list[str] = []
    daily_budget = float(cfg.get("daily_budget_usd") or 0)
    if daily_budget > 0 and cost_usd > daily_budget * 0.25:
        warnings.append(f"Estimation > 25 % du budget journalier (${daily_budget:.2f}).")
    return {
        "estimated_tokens": estimated_tokens,
        "estimated_tokens_in": est_in,
        "estimated_tokens_out": est_out,
        "estimated_cost_usd": cost_usd,
        "tier": tier,
        "warnings": warnings,
    }
