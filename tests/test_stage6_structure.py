from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def test_stage6_activity_pages_and_routes_exist():
    expected = [
        "app/(workspace)/app/activity/page.tsx",
        "app/(workspace)/app/activity/[id]/page.tsx",
        "app/api/activity/[id]/download/route.ts",
        "app/api/activity/[id]/retry/route.ts",
        "app/api/activity/[id]/resend/route.ts",
        "app/api/activity/[id]/correct/route.ts",
        "app/api/activity/[id]/delete/route.ts",
        "app/api/activity/[id]/approve/route.ts",
        "components/activity-actions.tsx",
        "components/run-status.tsx",
        "lib/run-operations.ts",
    ]
    for relative in expected:
        assert (WEB / relative).is_file(), relative


def test_stage6_database_keeps_automatic_and_manual_delivery_separate():
    db_text = (WEB / "lib/db.ts").read_text()
    assert "CREATE TABLE IF NOT EXISTS report_resend_logs" in db_text
    assert "manual_retry_count" in db_text
    assert "last_manual_retry_at" in db_text
    # Stage 5 automatic idempotency must remain in place.
    assert "UNIQUE(run_id)" in db_text


def test_stage6_retry_processes_failed_or_pending_queue_runs():
    db_text = (WEB / "lib/db.ts").read_text()
    assert 'row.queue_status !== "failed" && row.queue_status !== "pending"' in db_text
    assert "manual_retry_count = manual_retry_count + 1" in db_text
    assert "status = 'pending'" in db_text
    retry_route = (WEB / "app/api/activity/[id]/retry/route.ts").read_text()
    assert "markReportRunProcessing(id)" in retry_route
    assert "generateClaimedReportRun(id)" in retry_route


def test_stage6_pending_run_has_action_on_activity_list():
    activity = (WEB / "app/(workspace)/app/activity/page.tsx").read_text()
    assert 'run.queueStatus === "pending"' in activity
    assert '"Run now"' in activity
    assert "<ActivityActions" in activity
    assert "canDelete={run.operationalStatus !== \"processing\"}" in activity


def test_stage6_corrected_run_is_separate_and_uses_current_recipients():
    db_text = (WEB / "lib/db.ts").read_text()
    assert "export function createCorrectedReportRun" in db_text
    assert ":correction:${correctedRunId}" in db_text
    route = (WEB / "app/api/activity/[id]/correct/route.ts").read_text()
    assert "generateClaimedReportRun(created.runId)" in route
    actions = (WEB / "components/activity-actions.tsx").read_text()
    assert "Generate a fresh report for the same period for review? No email will be sent." in actions


def test_manual_generation_waits_for_review_and_explicit_send():
    run_now = (WEB / "app/api/projects/[id]/reports/[type]/run-now/route.ts").read_text()
    retry = (WEB / "app/api/activity/[id]/retry/route.ts").read_text()
    correct = (WEB / "app/api/activity/[id]/correct/route.ts").read_text()
    approval = (WEB / "app/api/activity/[id]/approve/route.ts").read_text()
    runner = (WEB / "lib/report-runner.ts").read_text()
    activity = (WEB / "app/(workspace)/app/activity/[id]/page.tsx").read_text()
    assert "generateClaimedReportRun(runId)" in run_now
    assert "deliverReportRun" not in run_now
    assert "generateClaimedReportRun(id)" in retry
    assert "generateClaimedReportRun(created.runId)" in correct
    assert "deliverReportRun(id)" in approval
    assert "Approve &amp; send" in activity
    assert "await deliverReportRun(runId)" in runner


def test_run_now_ui_describes_review_before_sending():
    form = (WEB / "components/run-report-now.tsx").read_text()
    actions = (WEB / "components/activity-actions.tsx").read_text()
    assert "Generate for review" in form
    assert "No email will be sent until you inspect the workbook" in form
    assert "Send the report file you reviewed to:" in actions


def test_stage6_delete_is_user_scoped_and_removes_artifact():
    db_text = (WEB / "lib/db.ts").read_text()
    assert "export function deleteReportRun(userId: string, runId: string)" in db_text
    assert "WHERE p.user_id = ? AND rrq.id = ?" in db_text
    assert "row.delivery_status === \"sending\"" in db_text
    route = (WEB / "app/api/activity/[id]/delete/route.ts").read_text()
    assert "generatedArtifactPath(deleted.filename)" in route
    assert "DELETE FROM report_run_queue WHERE id = ?" in db_text


def test_stage6_test_runs_cannot_be_manually_resent():
    operations = (WEB / "lib/run-operations.ts").read_text()
    assert 'run.runMode !== "production"' in operations
    assert "Test runs cannot be resent to clients" in operations


def test_stage6_failed_delivery_has_explicit_push_action():
    actions = (WEB / "components/activity-actions.tsx").read_text()
    detail = (WEB / "app/(workspace)/app/activity/[id]/page.tsx").read_text()
    assert "Push report now" in actions
    assert "window.confirm" in actions
    assert 'run.delivery?.status === "failed"' in detail


def test_stage6_download_is_user_scoped_and_storage_scoped():
    download = (WEB / "app/api/activity/[id]/download/route.ts").read_text()
    operations = (WEB / "lib/run-operations.ts").read_text()
    assert "getReportRunDetail(user.id, id)" in download
    assert "generatedArtifactPath" in download
    assert 'REPORTFLOW_GENERATED_DIR' in operations

    def test_artifact_storage_and_download_filenames_are_separate():
        db_text = (WEB / "lib/db.ts").read_text()
        runner = (WEB / "lib/report-runner.ts").read_text()
        download = (WEB / "app/api/activity/[id]/download/route.ts").read_text()
        delivery = (WEB / "lib/run-delivery.ts").read_text()
        assert "display_filename TEXT" in db_text
        assert "displayFilename: displayFilename" in runner or "displayFilename," in runner
        assert "artifact.filename" in download
        assert "artifact.display_filename" in delivery
        assert "artifact.filename.replace" in delivery
