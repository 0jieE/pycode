import re
import subprocess
import sys
from pathlib import Path

from app.core.config import Settings, settings
from app.worker.celery_app import celery_app

COMPOSE = Path("docker-compose.yml")


def test_celery_settings_match_the_spec() -> None:
    c = celery_app.conf
    assert c.worker_concurrency == settings.CELERY_CONCURRENCY  # from env CELERY_CONCURRENCY ...
    assert Settings.model_fields["CELERY_CONCURRENCY"].default == 6  # ... and 6 when it is not set
    assert c.worker_prefetch_multiplier == 1
    assert c.task_acks_late is True
    assert (c.task_soft_time_limit, c.task_time_limit) == (12, 15)
    assert c.worker_max_tasks_per_child == 200
    assert c.broker_url.startswith("redis://") and c.result_backend.startswith("redis://")
    # a crashed worker's job is redelivered after this; it must be longer than any job can run
    assert c.broker_transport_options["visibility_timeout"] > c.task_time_limit * 4


def test_beat_reaps_orphan_containers_every_minute() -> None:
    entry = next(e for e in celery_app.conf.beat_schedule.values()
                 if e["task"] == "app.worker.tasks.cleanup_orphan_containers")
    assert entry["schedule"] == 60.0


def services() -> dict[str, str]:
    """service name -> its block of docker-compose.yml"""
    text = COMPOSE.read_text()
    body = text.split("\nservices:\n", 1)[1].split("\nvolumes:\n", 1)[0]
    parts = re.split(r"(?m)^  ([\w-]+):\n", body)
    return dict(zip(parts[1::2], parts[2::2]))


def test_only_the_worker_mounts_the_docker_socket() -> None:
    blocks = services()
    assert {"api", "worker", "practice-worker", "beat", "redis", "mysql", "nginx"} <= set(blocks)
    with_socket = sorted(name for name, block in blocks.items() if "docker.sock" in block)
    assert with_socket == ["interactive-worker", "practice-worker", "worker"]  # only the services that start sandboxes


def test_every_service_restarts_and_has_a_healthcheck() -> None:
    for name, block in services().items():
        assert "restart: always" in block, name
        assert "healthcheck:" in block, name


def test_api_process_never_loads_the_docker_sdk_or_the_tasks() -> None:
    """The api container has no Docker socket; importing app.worker.sandbox there would crash it."""
    code = "import sys, app.main; bad = [m for m in ('docker', 'app.worker.tasks', 'app.worker.sandbox') if m in sys.modules]; sys.exit(1 if bad else 0)"
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_nginx_rate_limits_the_run_endpoint() -> None:
    conf = Path("nginx/nginx.conf").read_text()
    assert re.search(r"limit_req_zone\s+\$binary_remote_addr\s+zone=run_zone:10m\s+rate=2r/s", conf)
    # one rule covers both /workspace/{class_id}/run and /practice/run
    assert re.search(r"location ~ \^/api/v1/\(workspace/\[\^/\]\+\|practice\)/run\$ \{\s*limit_req zone=run_zone burst=5", conf)


def test_practice_runs_have_their_own_queue_and_a_small_worker() -> None:
    blocks = services()
    lab, practice = blocks["worker"], blocks["practice-worker"]
    assert "-Q celery" in lab and "-Q practice" not in lab          # the lab worker never serves practice ...
    assert "-Q practice" in practice and "-Q celery" not in practice  # ... and the practice worker never serves labs
    assert "-c ${PRACTICE_CONCURRENCY:-2}" in practice               # PRACTICE_CONCURRENCY, default 2
    assert "-c " not in lab and "CELERY_CONCURRENCY" not in practice  # lab capacity is untouched by the practice knob
    assert "build: ." in practice and "restart: always" in practice
    assert Settings.model_fields["PRACTICE_CONCURRENCY"].default == 2
    assert "PRACTICE_CONCURRENCY=" in Path(".env.example").read_text()
    assert "practice-worker:" in Path("docker-compose.prod.yml").read_text()


def test_celery_default_queue_is_the_lab_queue() -> None:
    from app.services import execution_service

    assert celery_app.conf.task_default_queue == "celery" == execution_service.QUEUE_NAME
    assert execution_service.PRACTICE_QUEUE == "practice"
