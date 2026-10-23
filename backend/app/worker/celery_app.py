from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init

from app.core.config import settings

# Only the worker imports app.worker.tasks (`celery worker -I app.worker.tasks`), because that pulls in
# the Docker SDK, which connects to the Docker socket at import time. The api and beat containers have
# no socket, so they refer to tasks by name (send_task / beat_schedule) and never import them.
celery_app = Celery("lab", broker=settings.REDIS_URL, backend=settings.REDIS_URL)

celery_app.conf.update(
    worker_concurrency=settings.CELERY_CONCURRENCY,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    # Lab runs use the default queue ("celery"); Practice runs use "practice", served by its own worker
    # (docker-compose.yml: practice-worker) so they can never take capacity away from a lab.
    task_default_queue="celery",
    task_soft_time_limit=12,
    task_time_limit=15,
    worker_max_tasks_per_child=200,
    # Results live in MySQL (executions table) and are streamed over Redis pub/sub, not read from Celery.
    task_ignore_result=True,
    result_expires=300,
    timezone="UTC",
    broker_connection_retry_on_startup=True,
    # Must stay well above task_time_limit AND above the longest interactive run (5 min): a crashed worker's task
    # is redelivered after this long.
    # (An interactive run can last 5 minutes and is only acknowledged when it ends; it is never run twice because
    # a redelivered job whose execution is no longer "queued" is skipped.)
    broker_transport_options={"visibility_timeout": 420, "socket_timeout": 5, "socket_connect_timeout": 5},
    beat_schedule={
        "reap-orphan-containers": {
            "task": "app.worker.tasks.cleanup_orphan_containers",
            "schedule": 60.0,
        },
        "session-schedule": {
            "task": "app.worker.tasks.run_session_schedule",
            "schedule": 15.0,
        },
        "presence-sweep": {
            "task": "app.worker.tasks.presence_sweep",
            "schedule": 10.0,
        },
        "delete-expired-registration-codes": {
            "task": "app.worker.tasks.delete_expired_registration_codes",
            "schedule": crontab(hour=3, minute=0),  # daily, 03:00 UTC
        },
        "docker-heartbeat": {
            "task": "app.worker.tasks.docker_heartbeat",
            "schedule": 15.0,
        },
    },
)


@worker_process_init.connect
def _fresh_db_pool(**_: object) -> None:
    """Each forked worker process opens its own MySQL connections instead of sharing the parent's."""
    from app.core.database import engine

    engine.dispose(close=False)
