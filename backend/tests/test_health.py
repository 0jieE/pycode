from unittest.mock import patch

from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["redis"] == "ok"


def test_health_degraded_when_database_down(client: TestClient) -> None:
    with patch("app.services.health_service.check_database", return_value="down"):
        r = client.get("/api/v1/health")
    assert r.status_code == 503
    assert r.json()["status"] == "degraded"
    assert r.json()["checks"]["database"] == "down"


def test_unknown_route_uses_error_format(client: TestClient) -> None:
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found", "code": "NOT_FOUND"}
