from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    anthropic_model: str = "claude-sonnet-4-6"
    agent_api_secret: str
    env: str = "development"
    max_tokens_per_job: int = 40000
    token_alert_threshold: int = 30000
    # Base de données Fleur d'Amours (VPS Coolify — valeurs via .env)
    fleur_db_host: str = "localhost"
    fleur_db_port: int = 3306
    fleur_db_user: str = "mariadb"
    fleur_db_password: str = ""
    fleur_db_name: str = "default"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
