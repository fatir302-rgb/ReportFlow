from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_desktop_server_is_loopback_only_and_rejects_port_conflicts():
    launcher = (ROOT / "launcher/ReportFlowLauncher.cs").read_text()
    package = (ROOT / "web/package.json").read_text()
    assert '" -H 127.0.0.1"' in launcher
    assert package.count("-H 127.0.0.1") == 2
    assert 'start.EnvironmentVariables["AUTH_URL"]' in launcher
    assert "port 3000 is already in use" in launcher
    assert "CreateTrayIcon(alreadyRunning)" not in launcher


def test_auth_uses_fixed_url_instead_of_unrestricted_host_trust():
    auth = (ROOT / "web/auth.ts").read_text()
    env_example = (ROOT / "web/.env.example").read_text()
    assert "trustHost: true" not in auth
    assert "AUTH_URL=http://localhost:3000" in env_example
    assert 'scope: "openid profile email"' in auth
    assert "User.Read" not in auth


def test_oauth_return_path_rejects_protocol_relative_redirects():
    state = (ROOT / "web/lib/oauth-state.ts").read_text()
    assert r"/^\/(?![\\/])/" in state


def test_security_headers_are_configured():
    config = (ROOT / "web/next.config.ts").read_text()
    for header in [
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
    ]:
        assert header in config


def test_internal_secrets_use_constant_time_comparison():
    security = (ROOT / "web/lib/request-security.ts").read_text()
    assert "timingSafeEqual" in security
    for route in [
        "web/app/api/internal/scheduler/tick/route.ts",
        "web/app/api/internal/delivery/run/route.ts",
        "web/app/api/internal/runs/artifact/route.ts",
    ]:
        assert "matchesSecret" in (ROOT / route).read_text()
