from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    """All configuration comes from environment variables / .env. No secrets in code."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENV: str = "dev"
    LOG_LEVEL: str = "INFO"
    ACCESS_LOG: bool = False  # per-request log lines; always on when ENV != "prod"

    # MySQL
    MYSQL_HOST: str = "mysql"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str
    MYSQL_PASSWORD: str
    MYSQL_DATABASE: str
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # Auth
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    JWT_LEEWAY_SECONDS: int = 30
    COOKIE_NAME: str = "lab_token"
    COOKIE_SECURE: bool = False  # LAN deployment is plain HTTP; set true behind TLS

    # The only peer whose X-Real-IP / X-Forwarded-For is believed: the Nginx container (a fixed address on the
    # compose network, docker-compose.yml). Comma-separated. Anything else is the client itself.
    TRUSTED_PROXY_IPS: str = "172.28.0.10"
    # Times written into messages (e.g. "'Lab 1' was due on Oct 14, 10:00 AM") are shown at this offset from UTC.
    DISPLAY_UTC_OFFSET_HOURS: int = 8

    # Celery / sandbox
    CELERY_CONCURRENCY: int = 6
    INTERACTIVE_CONCURRENCY: int = 40  # runs open at once on the "interactive" worker (docker-compose.yml)
    PRACTICE_CONCURRENCY: int = 2  # parallel runs of the separate "practice" worker (docker-compose.yml)

    @property
    def DATABASE_URL(self) -> URL:
        # URL.create escapes special characters in the password for us.
        return URL.create(
            "mysql+pymysql",
            username=self.MYSQL_USER,
            password=self.MYSQL_PASSWORD,
            host=self.MYSQL_HOST,
            port=self.MYSQL_PORT,
            database=self.MYSQL_DATABASE,
            query={"charset": "utf8mb4"},
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
