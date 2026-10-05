from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CLIENTS_DIR = ROOT / "config" / "clients"


class ReportRegistryError(RuntimeError):
    pass


def list_clients() -> list[dict[str, Any]]:
    clients: list[dict[str, Any]] = []
    for path in sorted(CLIENTS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        clients.append({
            "client_id": data["client_id"],
            "display_name": data.get("display_name", data["client_id"]),
            "report_types": sorted((data.get("reports") or {}).keys()),
        })
    return clients


def load_client(client_id: str) -> dict[str, Any]:
    path = CLIENTS_DIR / f"{client_id}.json"
    if not path.exists():
        raise ReportRegistryError(f"Unknown client: {client_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_report_definition(client_id: str, report_type: str) -> tuple[dict[str, Any], dict[str, Any], Path]:
    client = load_client(client_id)
    report = (client.get("reports") or {}).get(report_type)
    if not report:
        raise ReportRegistryError(f"Client '{client_id}' has no '{report_type}' report")

    profile_path = ROOT / report["profile"]
    template_path = ROOT / report["template"]
    if not profile_path.exists():
        raise ReportRegistryError(f"Profile missing: {profile_path}")
    if not template_path.exists():
        raise ReportRegistryError(f"Template missing: {template_path}")

    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    return client, profile, template_path
