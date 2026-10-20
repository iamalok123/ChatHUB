from __future__ import annotations


def test_health_is_public_and_reports_mock_mode(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["llm_mode"] == "mock"
    assert body["provider"]["name"] == "mock"
    assert body["provider"]["mock"] is True
    assert body["gemini"]["configured"] is False
    assert "api_key" not in body
    assert "key" not in {key.lower() for key in body}


def test_auth_config_is_public(client):
    response = client.get("/api/auth/config")
    assert response.status_code == 200
    assert response.json() == {"signup_enabled": True, "llm_mode": "mock"}
