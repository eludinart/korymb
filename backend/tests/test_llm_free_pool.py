"""Mélange de quotas gratuits : ordre des seaux et bascule sur 429."""
from __future__ import annotations

import httpx

from llm_free_pool import (
    configured_hops,
    free_pool_active,
    order_hops,
    post_with_failover,
)


def _cfg(**extra):
    base = {
        "llm_free_pool": "auto",
        "groq_api_key": "",
        "gemini_api_key": "",
        "openrouter_api_key": "",
        "openrouter_base_url": "https://openrouter.ai/api/v1",
        "gemini_model": "gemini-3.1-flash-lite",
        "llm_provider": "mistral",
        "mistral_api_key": "mistral-test",
        "mistral_model": "mistral-small-latest",
        "mistral_base_url": "https://api.mistral.ai/v1",
    }
    base.update(extra)
    return base


class _Scripted:
    def __init__(self, responses: list[httpx.Response]):
        self._responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    def post(self, url, json, headers):
        self.calls.append((url, str(json.get("model"))))
        if not self._responses:
            raise AssertionError("appel inattendu")
        return self._responses.pop(0)


def _json(status: int, message: str) -> httpx.Response:
    return httpx.Response(status, json={"error": {"message": message}})


def test_auto_stays_off_without_free_keys():
    assert free_pool_active(_cfg()) is False


def test_auto_turns_on_with_groq_and_orders_lite_before_heavy():
    cfg = _cfg(groq_api_key="gsk-test", gemini_api_key="gem-test", openrouter_api_key="or-test")
    assert free_pool_active(cfg) is True
    ids = [h.id for h in order_hops(configured_hops(cfg), "lite")]
    assert ids[0] == "groq-20b"
    assert ids.index("groq-qwen") < ids.index("groq-120b")
    assert ids.index("groq-120b") < ids.index("gemini")
    heavy = [h.id for h in order_hops(configured_hops(cfg), "heavy")]
    assert heavy[0] == "groq-120b"
    assert "groq-20b" in heavy[1:]


def test_off_switch_ignores_groq_key():
    assert free_pool_active(_cfg(llm_free_pool="off", groq_api_key="gsk-test")) is False


def test_daily_quota_switches_bucket_without_retrying_the_same_model():
    cfg = _cfg(llm_free_pool="on", groq_api_key="gsk-test")
    client = _Scripted(
        [
            _json(429, "Rate limit reached for tokens per day (TPD): Limit 200000"),
            httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "ok"}}],
                    "usage": {"prompt_tokens": 3, "completion_tokens": 1},
                },
            ),
        ]
    )
    response, meta = post_with_failover(client, cfg, {"messages": [], "max_tokens": 100}, profile="lite")
    assert response.status_code == 200
    assert [model for _, model in client.calls] == ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    assert meta["model"] == "qwen/qwen3.8-27b"
    assert meta["price_in"] == 0.0
    assert client.calls[0][0].startswith("https://api.groq.com/")


def test_bad_groq_key_skips_the_other_groq_buckets():
    cfg = _cfg(llm_free_pool="on", groq_api_key="bad", gemini_api_key="gem-test")
    client = _Scripted(
        [
            _json(401, "Invalid API Key"),
            httpx.Response(200, json={"choices": [{"message": {"content": "gem"}}], "usage": {}}),
        ]
    )
    response, meta = post_with_failover(client, cfg, {"messages": [], "max_tokens": 50}, profile="heavy")
    assert response.status_code == 200
    assert [model for _, model in client.calls] == ["openai/gpt-oss-120b", "gemini-3.1-flash-lite"]
    assert meta["provider"] == "gemini"
    assert "generativelanguage.googleapis.com" in client.calls[1][0]
