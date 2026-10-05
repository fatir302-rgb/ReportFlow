from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def test_stage5_provider_routes_exist():
    expected = [
        "app/api/connections/gmail/start/route.ts",
        "app/api/connections/gmail/callback/route.ts",
        "app/api/connections/outlook/start/route.ts",
        "app/api/connections/outlook/callback/route.ts",
        "app/api/connections/email/disconnect/route.ts",
    ]
    for relative in expected:
        assert (WEB / relative).is_file(), relative


def test_stage5_delivery_schema_and_idempotency():
    db_text = (WEB / "lib/db.ts").read_text()
    assert "CREATE TABLE IF NOT EXISTS report_delivery_configurations" in db_text
    assert "CREATE TABLE IF NOT EXISTS report_delivery_logs" in db_text
    assert "UNIQUE(run_id)" in db_text
    assert "CREATE TABLE IF NOT EXISTS report_run_artifacts" in db_text


def test_stage5_minimal_provider_permissions():
    google = (WEB / "app/api/connections/gmail/start/route.ts").read_text()
    microsoft = (WEB / "app/api/connections/outlook/start/route.ts").read_text()
    assert "https://www.googleapis.com/auth/gmail.send" in google
    assert "https://mail.google.com/" not in google
    assert "Mail.Send" in microsoft
    assert "offline_access" in microsoft


def test_stage5_test_mode_is_suppressed():
    delivery = (WEB / "lib/run-delivery.ts").read_text()
    assert 'context.run_mode !== "production"' in delivery
    assert 'status: "skipped_test"' in delivery
