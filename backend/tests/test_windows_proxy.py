"""The Windows deployment (Docker Desktop hides lab PCs' addresses, so a Nginx on Windows sits in front). These check
the configuration files, so a later edit cannot quietly turn the setup into one where a client can fake its address."""
import re
from pathlib import Path

WINDOWS_NGINX = Path("deploy/windows/nginx.conf").read_text()
DOCKER_NGINX = Path("nginx/nginx.conf").read_text()
REALIP = Path("nginx/realip-windows.conf").read_text()
OVERLAY = Path("docker-compose.windows.yml").read_text()
BASE = Path("docker-compose.yml").read_text()


def directives(text: str) -> list[str]:
    """The configuration lines, without comments (whole-line or trailing)."""
    return [line.split("#", 1)[0].strip() for line in text.splitlines() if line.split("#", 1)[0].strip()]


def test_the_windows_nginx_overwrites_the_address_headers_with_the_real_client() -> None:
    lines = directives(WINDOWS_NGINX)
    assert "proxy_set_header X-Real-IP $remote_addr;" in lines
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in lines
    assert "$proxy_add_x_forwarded_for" not in WINDOWS_NGINX          # never append what the client sent
    assert "server 127.0.0.1:8080;" in lines and "listen 80;" in lines
    assert "proxy_set_header Upgrade $http_upgrade;" in lines         # WebSockets go through


def test_the_docker_nginx_believes_the_header_from_the_docker_gateway_only() -> None:
    lines = directives(REALIP)
    assert lines == ["set_real_ip_from 172.28.0.1;", "real_ip_header   X-Real-IP;"]
    # the trusted address is the gateway of the compose subnet, and nothing wider (no CIDR, no 0.0.0.0/0)
    assert "subnet: 172.28.0.0/24" in BASE


def test_only_the_windows_mode_trusts_the_header() -> None:
    assert "include /etc/nginx/realip.d/*.conf;" in directives(DOCKER_NGINX)
    assert "realip" not in BASE                                        # plain mode mounts nothing there
    assert "./nginx/realip-windows.conf:/etc/nginx/realip.d/windows.conf:ro" in OVERLAY
    assert "set_real_ip_from" not in DOCKER_NGINX                      # never trusted in the main file


def test_in_windows_mode_docker_nginx_is_reachable_from_the_server_itself_only() -> None:
    ports = re.findall(r'^\s*- "([^"]+)"', OVERLAY, re.M)
    assert ports == ["127.0.0.1:${DOCKER_NGINX_PORT:-8080}:80"]
    assert "ports: !override" in OVERLAY                                # replaces port 80, not added to it


def test_the_install_script_needs_admin_and_opens_only_port_80_on_private_networks() -> None:
    script = Path("deploy/windows/install-nginx.ps1").read_text()
    assert "IsInRole" in script and "Administrator" in script
    assert "-LocalPort 80" in script and "-Profile Private,Domain" in script
    assert '-User "SYSTEM"' in script and "-AtStartup" in script
    assert "nginx.conf" in script and "-t" in script                   # the configuration is tested before use
