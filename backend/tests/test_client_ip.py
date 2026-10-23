"""The client address recorded in the audit log (and used by the login rate limit): proxy headers are believed only
from Nginx, so a client cannot write someone else's address into the log."""
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.main import app
from app.models.activity_log import ActivityLog
from app.models.user import Role
from tests.conftest import login, make_user

NGINX = "172.28.0.10"          # the trusted proxy (settings.TRUSTED_PROXY_IPS)
LAPTOP = "192.168.50.77"


def login_ip(db: Session) -> str:
    db.expire_all()
    return db.scalars(select(ActivityLog.ip_address).where(ActivityLog.action == "login")
                      .order_by(ActivityLog.id.desc())).first()


def test_a_spoofed_header_from_a_client_is_ignored(db: Session) -> None:
    make_user(db, Role.STUDENT, "ana")
    laptop = TestClient(app, client=(LAPTOP, 50000))
    for headers in ({"X-Forwarded-For": "10.10.0.1"}, {"X-Real-IP": "10.10.0.1"},
                    {"X-Forwarded-For": "10.10.0.1, 10.10.0.2", "X-Real-IP": "10.10.0.2"}):
        laptop.headers.update(headers)
        assert login(laptop, "ana").status_code == 200
        assert login_ip(db) == LAPTOP
        for key in headers:
            del laptop.headers[key]


def test_the_headers_are_believed_only_from_nginx(db: Session) -> None:
    make_user(db, Role.STUDENT, "ana")
    through_nginx = TestClient(app, client=(NGINX, 50000))
    through_nginx.headers["X-Real-IP"] = "10.10.0.3"
    assert login(through_nginx, "ana").status_code == 200 and login_ip(db) == "10.10.0.3"
    del through_nginx.headers["X-Real-IP"]
    through_nginx.headers["X-Forwarded-For"] = "10.10.0.4"
    assert login(through_nginx, "ana").status_code == 200 and login_ip(db) == "10.10.0.4"
    through_nginx.headers["X-Forwarded-For"] = "not-an-ip"
    assert login(through_nginx, "ana").status_code == 200 and login_ip(db) == NGINX   # garbage is never believed


def test_the_proxy_configuration_overwrites_and_trusts_only_nginx() -> None:
    for conf in (Path("nginx/api_proxy.conf").read_text(), Path("nginx/nginx.conf").read_text()):
        assert "$proxy_add_x_forwarded_for" not in conf      # never append what the client sent
    assert "proxy_set_header X-Forwarded-For $remote_addr" in Path("nginx/api_proxy.conf").read_text()
    assert "proxy_set_header X-Real-IP $remote_addr" in Path("nginx/api_proxy.conf").read_text()
    compose = Path("docker-compose.yml").read_text()
    assert f"--forwarded-allow-ips {NGINX}" in compose and f"ipv4_address: {NGINX}" in compose
    assert 'forwarded_allow_ips = os.getenv("TRUSTED_PROXY_IPS", "172.28.0.10")' in Path("gunicorn.conf.py").read_text()
    from app.core.config import Settings
    assert Settings.model_fields["TRUSTED_PROXY_IPS"].default == NGINX
