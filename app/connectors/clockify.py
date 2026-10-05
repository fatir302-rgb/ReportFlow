from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.models import NormalizedTimeEntry


class ClockifyError(RuntimeError):
    pass


class ClockifyClient:
    def __init__(self, api_key: str, api_base: str, reports_base: str, timeout: float = 30.0):
        if not api_key:
            raise ClockifyError("CLOCKIFY_API_KEY is not configured.")
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.reports_base = reports_base.rstrip("/")
        self.timeout = timeout

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Api-Key": self.api_key, "Accept": "application/json"}

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.get(f"{self.api_base}{path}", headers=self.headers, params=params)
        if response.is_error:
            raise ClockifyError(f"Clockify GET {path} failed ({response.status_code}): {response.text[:500]}")
        return response.json()

    def current_user(self) -> dict[str, Any]:
        return self._get("/user")

    def workspaces(self) -> list[dict[str, Any]]:
        return self._get("/workspaces")

    def projects(self, workspace_id: str) -> list[dict[str, Any]]:
        all_projects: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = self._get(
                f"/workspaces/{workspace_id}/projects",
                params={"page": page, "page-size": 200, "sort-column": "NAME", "sort-order": "ASCENDING"},
            )
            if not batch:
                break
            all_projects.extend(batch)
            if len(batch) < 200:
                break
            page += 1
        return all_projects

    def detailed_entries(
        self,
        workspace_id: str,
        date_start: datetime,
        date_end: datetime,
        timezone: str,
        project_id: str | None = None,
        project_ids: list[str] | None = None,
        user_id: str | None = None,
    ) -> list[NormalizedTimeEntry]:
        page = 1
        page_size = 200
        output: list[NormalizedTimeEntry] = []

        while True:
            body: dict[str, Any] = {
                "dateRangeStart": date_start.isoformat(),
                "dateRangeEnd": date_end.isoformat(),
                "dateRangeType": "ABSOLUTE",
                "exportType": "JSON",
                "timeZone": timezone,
                "sortOrder": "ASCENDING",
                "detailedFilter": {
                    "page": page,
                    "pageSize": page_size,
                    "options": {"totals": "CALCULATE"},
                },
            }
            selected_project_ids = project_ids or ([project_id] if project_id else [])
            if selected_project_ids:
                body["projects"] = {"contains": "CONTAINS", "ids": selected_project_ids, "status": "ALL"}
            if user_id:
                body["users"] = {"contains": "CONTAINS", "ids": [user_id], "status": "ALL"}

            url = f"{self.reports_base}/workspaces/{workspace_id}/reports/detailed"
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(url, headers={**self.headers, "Content-Type": "application/json"}, json=body)
            if response.is_error:
                raise ClockifyError(
                    f"Clockify detailed report failed ({response.status_code}): {response.text[:800]}"
                )

            payload = response.json()
            raw_entries = payload.get("timeentries") or payload.get("timeEntries") or []
            if not isinstance(raw_entries, list):
                raise ClockifyError(f"Unexpected detailed report shape. Top-level keys: {list(payload.keys())}")

            output.extend(self._normalize_entries(raw_entries))
            if len(raw_entries) < page_size:
                break
            page += 1

        return output

    @staticmethod
    def _normalize_entries(entries: list[dict[str, Any]]) -> list[NormalizedTimeEntry]:
        normalized: list[NormalizedTimeEntry] = []
        for item in entries:
            interval = item.get("timeInterval") or item.get("timeinterval") or {}
            start_raw = interval.get("start") or item.get("timeIntervalStart")
            end_raw = interval.get("end") or item.get("timeIntervalEnd")
            if not start_raw or not end_raw:
                continue

            start = datetime.fromisoformat(str(start_raw).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00"))
            seconds = max(0, int((end - start).total_seconds()))

            normalized.append(
                NormalizedTimeEntry(
                    id=str(item.get("_id") or item.get("id") or ""),
                    user_name=str(item.get("userName") or item.get("username") or ""),
                    project_name=str(item.get("projectName") or item.get("projectname") or ""),
                    task_name=str(item.get("taskName") or item.get("taskname") or ""),
                    description=str(item.get("description") or ""),
                    start=start,
                    end=end,
                    duration_seconds=seconds,
                )
            )
        return normalized
