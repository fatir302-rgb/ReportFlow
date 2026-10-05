from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = (ROOT / "web/lib/db.ts").read_text()
AGENT = (ROOT / "web/lib/ai-agent.ts").read_text()
CHAT = (ROOT / "web/app/api/assistant/chat/route.ts").read_text()


def test_stage7_has_conversation_and_draft_tables():
    assert "CREATE TABLE IF NOT EXISTS ai_conversations" in DB
    assert "CREATE TABLE IF NOT EXISTS ai_messages" in DB
    assert "CREATE TABLE IF NOT EXISTS ai_change_requests" in DB
    assert "base_snapshot_json" in DB


def test_agent_uses_structured_responses_and_server_api_key():
    assert "https://api.openai.com/v1/responses" in AGENT
    assert 'type: "json_schema"' in AGENT
    assert "OPENAI_API_KEY" in AGENT
    assert "REPORTFLOW_AI_MODEL" in AGENT


def test_agent_snapshot_excludes_connection_credentials():
    # The model context must never select/decrypt connector credentials.
    assert "credentials_enc" not in AGENT
    assert "decrypt" not in AGENT.lower()


def test_ai_chat_creates_proposal_not_configuration_mutation():
    assert "createAIChangeRequest" in CHAT
    forbidden = ["saveReportConfiguration", "saveReportSchedule", "saveReportDeliveryConfiguration", "updateProject"]
    for name in forbidden:
        assert name not in CHAT


def test_change_requests_require_approval_in_agent_rules():
    assert "requiresApproval=true" in AGENT
    assert 'parsed.requiresApproval = true' in AGENT
