from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Un seul fichier .env : backend/.env.
        # On conserve la priorité du fichier sur les variables shell.
        return init_settings, dotenv_settings, env_settings, file_secret_settings

    # ── Auth interne Korymb ─────────────────────────────────────────────────
    agent_api_secret: str

    @field_validator("agent_api_secret", mode="before")
    @classmethod
    def strip_agent_secret(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("llm_provider", mode="before")
    @classmethod
    def coerce_legacy_google_llm_provider(cls, v):
        """Ancien LLM_PROVIDER=google (AI Studio direct) : traité comme OpenRouter."""
        if isinstance(v, str) and v.strip().lower() == "google":
            return "openrouter"
        return v

    # ── Fournisseur LLM : anthropic | openrouter ─────────────────────────────
    llm_provider: Literal["anthropic", "openrouter"] = "anthropic"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_models: str = "claude-sonnet-4-6,claude-3-5-haiku-latest"

    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-4o-mini"
    openrouter_models: str = (
        "google/gemma-3-27b-it:free,google/gemma-2-9b-it:free,google/gemma-7b-it:free,"
        "google/gemini-2.0-flash-exp:free,openai/gpt-4o-mini,google/gemini-2.5-flash-lite,"
        "anthropic/claude-3.5-haiku"
    )
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_http_referer: str = ""
    openrouter_app_title: str = "Korymb"

    # Estimation coût (USD / million de tokens) pour le widget /jobs ; à ajuster selon le modèle OpenRouter
    llm_price_input_per_million_usd: float = 3.0
    llm_price_output_per_million_usd: float = 15.0

    env: str = "development"
    max_tokens_per_job: int = 40000
    token_alert_threshold: int = 30000
    fleur_db_host: str = "localhost"
    fleur_db_port: int = 3306
    fleur_db_user: str = "mariadb"
    fleur_db_password: str = ""
    fleur_db_name: str = "default"


settings = Settings()
