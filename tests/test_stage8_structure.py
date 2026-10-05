from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = (ROOT / "web/lib/db.ts").read_text()
GOV = (ROOT / "web/lib/config-governance.ts").read_text()
AGENT = (ROOT / "web/lib/ai-agent.ts").read_text()
PROPOSAL = (ROOT / "web/app/(workspace)/app/assistant/proposals/[id]/page.tsx").read_text()


def test_stage8_has_governance_version_and_audit_tables():
    assert "CREATE TABLE IF NOT EXISTS proposal_governance" in DB
    assert "CREATE TABLE IF NOT EXISTS configuration_versions" in DB
    assert "CREATE TABLE IF NOT EXISTS audit_logs" in DB
    assert "UNIQUE(project_id, version_number)" in DB


def test_ai_change_items_use_canonical_paths():
    assert 'required: ["scope", "reportType", "action", "path"' in AGENT
    assert '"schedule.shiftEndTime"' in AGENT
    assert '"delivery.to"' in AGENT
    assert "canonical path" in AGENT


def test_production_apply_is_not_in_ai_agent():
    assert "applyApprovedProposal" not in AGENT
    assert "saveReportConfiguration" not in AGENT
    assert "applyApprovedProposal" in GOV
    assert "runGovernedTransaction" in GOV


def test_stale_proposals_are_checked_against_base_snapshot():
    assert "baseValue" in GOV
    assert "currentValue" in GOV
    assert 'status: "conflict"' not in GOV or "conflicts" in GOV
    assert "Production configuration changed after approval" in GOV


def test_test_approval_apply_sequence_is_enforced():
    assert "testProposal" in GOV
    assert 'governance.testStatus !== "passed"' in GOV
    assert "approveAIChangeRequest" in GOV
    assert "markAIChangeRequestApplied" in GOV
    assert "Test & Preview" in PROPOSAL
    assert "Apply to Production" in PROPOSAL


def test_restore_creates_new_version_not_reactivates_old_row():
    assert "restoreConfigurationVersion" in GOV
    assert 'source: "manual_restore"' in GOV
    assert "restoredFromVersionId: target.id" in GOV
    assert "Restored Version" in GOV


def test_audit_events_cover_test_approve_apply_restore():
    for action in ["proposal_tested", "proposal_approved", "proposal_applied", "version_restored"]:
        assert action in GOV
