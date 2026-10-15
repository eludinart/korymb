"""Mélange de quotas gratuits : ordre des seaux et bascule sur 429."""
from __future__ import annotations

import httpx

from llm_tiers import resolve_llm_tier
from llm_free_pool import (
    _fit_groq_messages,
    configured_hops,
    free_pool_active,
    free_pool_public,
    order_hops,
    post_with_failover,
)


def _cfg(**extra):
    base = {
        "llm_free_pool": "auto",
        "groq_api_key": "",
        "gemini_api_key": "",
        "openrouter_api_key": "",
        "deepseek_api_key": "",
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
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


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


def _ok(content: str = "ok") -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}}], "usage": {}},
    )


def test_tpm_413_skips_the_other_groq_models():
    cfg = _cfg(llm_free_pool="on", groq_api_key="gsk-test", gemini_api_key="gem-test")
    too_big = (
        "Request too large for model on tokens per minute (TPM): "
        "Limit 8000, Requested 8525. https://console.groq.com/settings/billing"
    )
    client = _Scripted([_json(413, too_big), _ok("gem")])
    response, meta = post_with_failover(client, cfg, {"messages": [], "max_tokens": 100}, profile="lite")
    assert response.status_code == 200
    assert [model for _, model in client.calls] == ["openai/gpt-oss-20b", "gemini-3.1-flash-lite"]
    assert meta["provider"] == "gemini"


def test_openrouter_free_slots_and_optional_deepseek():
    cfg = _cfg(llm_free_pool="on", openrouter_api_key="or-test", groq_api_key="gsk-test")
    models = [hop.model for hop in order_hops(configured_hops(cfg), "lite")]
    assert "deepseek/deepseek-v4-flash:free" in models
    assert models.index("deepseek/deepseek-v4-flash:free") < models.index(
        "nvidia/nemotron-3-ultra-550b-a55b:free"
    )
    assert all(hop.id != "deepseek-paid" for hop in configured_hops(cfg))
    paid = _cfg(
        llm_free_pool="on",
        openrouter_api_key="or-test",
        groq_api_key="gsk-test",
        deepseek_api_key="sk-test",
    )
    ordered = order_hops(configured_hops(paid), "lite")
    assert ordered[-1].id == "deepseek-paid"
    assert ordered[-1].provider == "deepseek"
    assert ordered[-1].paid is True


def test_prefer_hop_starts_there_and_publishes_quota():
    cfg = _cfg(
        llm_free_pool="on",
        groq_api_key="gsk-test",
        gemini_api_key="gem-test",
        openrouter_api_key="or-test",
        llm_prefer_hop_id="gemini",
    )
    public = free_pool_public(cfg)
    assert public["prefer_hop_id"] == "gemini"
    assert public["hops"][0]["id"] == "gemini"
    assert public["hops"][0]["start"] is True
    assert public["hops"][0]["billing"] == "gratuit"
    assert "Google" in public["hops"][0]["quota"]
    groq = next(hop for hop in public["hops"] if hop["id"] == "groq-20b")
    assert groq["billing"] == "gratuit"
    assert "8 000" in groq["quota"]
    client = _Scripted([_json(429, "Rate limit reached"), _ok("suite")])
    response, meta = post_with_failover(client, cfg, {"messages": [], "max_tokens": 20}, profile="lite")
    assert response.status_code == 200
    assert [model for _, model in client.calls][:2] == ["gemini-3.1-flash-lite", "openai/gpt-oss-20b"]
    assert meta["model"] == "openai/gpt-oss-20b"


def test_configured_paid_models_join_the_menu():
    cfg = _cfg(
        llm_free_pool="on",
        groq_api_key="gsk-test",
        openrouter_api_key="or-test",
        anthropic_api_key="sk-ant-test",
        mistral_models="mistral-small-latest,mistral-large-latest",
        anthropic_models="claude-sonnet-4-6",
        openrouter_models="openai/gpt-4o-mini,google/gemma-3-27b-it:free",
        openrouter_model="openai/gpt-4o-mini",
    )
    public = free_pool_public(cfg)
    by_model = {hop["model"]: hop for hop in public["hops"]}
    assert by_model["mistral-large-latest"]["billing"] == "payant"
    assert by_model["mistral-large-latest"]["provider"] == "mistral"
    assert "Mistral" in by_model["mistral-large-latest"]["quota"]
    assert by_model["openai/gpt-4o-mini"]["billing"] == "payant"
    assert by_model["claude-sonnet-4-6"]["billing"] == "payant"
    assert by_model["google/gemma-3-27b-it:free"]["billing"] == "gratuit"
    assert public["hops"][0]["provider"] == "groq"
    assert public["hops"][-1]["id"] != "mistral-mistral-large-latest"


def test_groq_prompt_keeps_the_latest_turn_under_the_budget():
    huge = "x" * 40000
    fitted = _fit_groq_messages(
        [
            {"role": "system", "content": "consigne"},
            {"role": "user", "content": huge},
            {"role": "assistant", "content": huge},
            {"role": "user", "content": "question courte"},
        ],
        None,
    )
    assert fitted[0]["content"] == "consigne"
    assert fitted[-1]["content"] == "question courte"
    assert len(fitted) < 4


def test_invalid_model_id_switches_bucket():
    cfg = _cfg(llm_free_pool="on", groq_api_key="gsk-test")
    client = _Scripted([_json(400, "ministral-8b-latest is not a valid model ID"), _ok()])
    response, meta = post_with_failover(client, cfg, {"messages": [], "max_tokens": 50}, profile="lite")
    assert response.status_code == 200
    assert [model for _, model in client.calls] == ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    assert meta["model"] == "qwen/qwen3.8-27b"


def test_timeout_on_first_hop_tries_the_next():
    cfg = _cfg(llm_free_pool="on", groq_api_key="gsk-test", gemini_api_key="gem-test")
    client = _Scripted([httpx.ReadTimeout("timed out"), _ok("suite")])
    response, meta = post_with_failover(client, cfg, {"messages": [], "max_tokens": 50}, profile="lite")
    assert response.status_code == 200
    assert [model for _, model in client.calls] == ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    assert meta["model"] == "qwen/qwen3.8-27b"


def test_openrouter_ignores_leftover_mistral_tier():
    cfg = _cfg(
        llm_provider="openrouter",
        openrouter_model="google/gemini-2.5-flash-lite",
        llm_tiers_json=(
            '{"lite":{"model":"ministral-8b-latest",'
            '"price_input_per_million_usd":0.1,"price_output_per_million_usd":0.1}}'
        ),
    )
    model, tier, _, _ = resolve_llm_tier(cfg, "lite")
    assert model == "google/gemini-2.5-flash-lite"
    assert tier == "default"
