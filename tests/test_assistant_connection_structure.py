from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def test_users_can_manage_an_encrypted_openai_connection():
    route = (WEB / "app/api/assistant/connection/route.ts").read_text()
    component = (WEB / "components/assistant-connection.tsx").read_text()
    assert "currentAppUser" in route
    assert "validateOpenAIKey" in route
    assert "encryptSecret(apiKey)" in route
    assert 'provider: "openai"' in route
    assert 'type="password"' in component
    assert "Remove your saved OpenAI API key" in component


def test_assistant_prefers_the_users_key_and_keeps_server_fallback():
    credentials = (WEB / "lib/assistant-credentials.ts").read_text(encoding="utf-8")
    agent = (WEB / "lib/ai-agent.ts").read_text(encoding="utf-8")
    page = (WEB / "app/(workspace)/app/assistant/page.tsx").read_text(encoding="utf-8")
    assert 'getConnection(userId, "openai")' in credentials
    assert "decryptSecret(personalConnection.credentials_enc)" in credentials
    assert "process.env.OPENAI_API_KEY" in credentials
    assert "credentials_enc" not in agent
    assert "<AssistantConnection" in page
