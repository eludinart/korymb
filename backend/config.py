from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

# Racine du dépôt : le `.env` Vite (OPENROUTER_*, LLM_*) y vit souvent ; `backend/.env` reste la source prioritaire (dernier chargé).
_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            _REPO_ROOT / ".env",
            _BACKEND_DIR / ".env",
        ),
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
        # Par défaut pydantic-settings : env puis .env → le shell écrase le fichier.
        # Ici .env avant env : `backend/.env` reste aligné avec VITE_AGENT_SECRET (évite une AGENT_API_SECRET « coincée » dans le terminal).
        return init_settings, dotenv_settings, env_settings, file_secret_settings

    # ── Auth interne Korymb ─────────────────────────────────────────────────
    agent_api_secret: str

    @field_validator("agent_api_secret", mode="before")
    @classmethod
    def strip_agent_secret(cls, v):
        return v.strip() if isinstance(v, str) else v

    # ── Fournisseur LLM : anthropic | openrouter ────────────────────────────
    llm_provider: Literal["anthropic", "openrouter"] = "anthropic"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-4o-mini"
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
