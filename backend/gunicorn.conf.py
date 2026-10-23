"""Production server settings: `gunicorn -c gunicorn.conf.py app.main:app` (behind Nginx)."""
import os

bind = "0.0.0.0:8000"
workers = int(os.getenv("WEB_CONCURRENCY", "4"))
worker_class = "uvicorn.workers.UvicornWorker"

# Believe X-Forwarded-For only from Nginx's fixed address on the compose network (docker-compose.yml); from anyone
# else it is ignored, so a client cannot fake its IP (the seat map and the seat lock depend on it).
forwarded_allow_ips = os.getenv("TRUSTED_PROXY_IPS", "172.28.0.10")

# An async worker only needs to prove it is alive; slow requests are bounded by the DB and Celery limits.
timeout = 60
graceful_timeout = 30   # on restart, let open requests finish
# Must be LONGER than Nginx's upstream keepalive_timeout (60 s). If we closed idle connections first, a request
# that Nginx sends at that very moment would hit a dead socket and fail (the autosave runs every 5 s).
keepalive = 75

# A busy lab means thousands of autosave requests: no per-request access log unless asked for.
accesslog = "-" if os.getenv("ACCESS_LOG", "").lower() in ("1", "true", "yes") else None
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()

# gunicorn's own logs use the same one-JSON-object-per-line format as the application.
logconfig_dict = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "app.core.logging.JsonFormatter"}},
    "handlers": {"stdout": {"class": "logging.StreamHandler", "formatter": "json", "stream": "ext://sys.stdout"}},
    "root": {"level": loglevel.upper(), "handlers": ["stdout"]},
    "loggers": {
        "gunicorn.error": {"level": loglevel.upper(), "handlers": ["stdout"], "propagate": False},
        "gunicorn.access": {"level": "INFO", "handlers": ["stdout"], "propagate": False},
    },
}
