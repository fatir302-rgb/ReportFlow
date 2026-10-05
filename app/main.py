from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.connectors.clockify import ClockifyClient, ClockifyError
from app.demo import create_demo_template, demo_entries
from app.reporting.engine import ReportGenerationError, generate_report, generate_xlsx
from app.reporting.profile import DEFAULT_PROFILE
from app.reporting.registry import ReportRegistryError, list_clients, load_client, load_report_definition

app = FastAPI(
    title="ReportFlow MVP",
    version="0.2.0",
    description="Milestone 1.1: Clockify -> normalized entries -> client-specific report renderers -> validation.",
)


def clockify() -> ClockifyClient:
    return ClockifyClient(
        api_key=settings.clockify_api_key,
        api_base=settings.clockify_api_base,
        reports_base=settings.clockify_reports_base,
    )


@app.get("/")
def root():
    return {
        "name": "ReportFlow MVP",
        "milestone": "Clockify -> Excel",
        "docs": "/docs",
        "clockify_configured": bool(settings.clockify_api_key),
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/clockify/me")
def clockify_me():
    try:
        return clockify().current_user()
    except ClockifyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/clockify/workspaces")
def clockify_workspaces():
    try:
        return clockify().workspaces()
    except ClockifyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/clockify/workspaces/{workspace_id}/projects")
def clockify_projects(workspace_id: str):
    try:
        return clockify().projects(workspace_id)
    except ClockifyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/clients")
def clients():
    return list_clients()


@app.get("/api/clients/{client_id}")
def client_definition(client_id: str):
    try:
        return load_client(client_id)
    except ReportRegistryError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/reports/client/{client_id}/{report_type}")
def generate_saved_client_report(
    client_id: str,
    report_type: str,
    workspace_id: str = Form(...),
    user_id: str | None = Form(None),
    employee_name: str = Form(...),
    date_start: str = Form(...),
    date_end: str = Form(...),
    timezone: str = Form(settings.default_timezone),
    project_ids_json: str | None = Form(None, description="Optional JSON array of Clockify project IDs"),
):
    try:
        start = datetime.fromisoformat(date_start)
        end = datetime.fromisoformat(date_end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date_start/date_end must be valid ISO datetimes") from exc
    if end <= start:
        raise HTTPException(status_code=422, detail="date_end must be later than date_start")

    try:
        client, profile, template_path = load_report_definition(client_id, report_type)
    except ReportRegistryError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    project_ids = None
    if project_ids_json:
        try:
            value = json.loads(project_ids_json)
            if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
                raise ValueError
            project_ids = value
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="project_ids_json must be a JSON array of strings") from exc

    run_id = uuid4().hex[:10]
    suffix = str((client.get("reports") or {})[report_type].get("output_extension") or template_path.suffix)
    output_path = settings.output_path / f"{client_id}-{report_type}-{run_id}{suffix}"

    try:
        entries = clockify().detailed_entries(
            workspace_id=workspace_id,
            date_start=start,
            date_end=end,
            timezone=timezone,
            project_ids=project_ids,
            user_id=user_id,
        )
        if not entries:
            raise HTTPException(status_code=404, detail="Clockify returned no entries for this selection")
        result = generate_report(
            template_path=template_path,
            output_path=output_path,
            entries=entries,
            profile=profile,
            employee_name=employee_name,
            project_name=client.get("display_name", client_id),
            period_start=start,
            period_end=end,
        )
    except ClockifyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ReportGenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    media = (
        "application/vnd.ms-excel.sheet.macroEnabled.12"
        if suffix.lower() == ".xlsm"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    filename = f"{client_id}_{report_type}_{start:%Y-%m-%d}_{end:%Y-%m-%d}{suffix}"
    return FileResponse(
        output_path,
        filename=filename,
        media_type=media,
        headers={"X-Report-Validation": result.model_dump_json()},
    )


@app.post("/api/reports/demo")
def generate_demo_report():
    run_id = uuid4().hex[:10]
    template_path = settings.output_path / f"demo-template-{run_id}.xlsx"
    output_path = settings.output_path / f"demo-report-{run_id}.xlsx"
    create_demo_template(template_path)
    entries = demo_entries()
    result = generate_xlsx(
        template_path=template_path,
        output_path=output_path,
        entries=entries,
        profile=DEFAULT_PROFILE,
        employee_name="Demo User",
        project_name="Demo Project",
        period_start=datetime(2026, 8, 17),
        period_end=datetime(2026, 8, 21, 23, 59, 59),
    )
    return FileResponse(
        output_path,
        filename="ReportFlow_Demo_Weekly.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"X-Report-Validation": result.model_dump_json()},
    )


@app.post("/api/reports/clockify")
def generate_clockify_report(
    workspace_id: str = Form(...),
    project_id: str | None = Form(None),
    user_id: str | None = Form(None),
    employee_name: str = Form(...),
    project_name: str = Form(...),
    date_start: str = Form(..., description="ISO datetime, e.g. 2026-08-17T00:00:00+05:00"),
    date_end: str = Form(..., description="ISO datetime, e.g. 2026-08-22T05:00:00+05:00"),
    timezone: str = Form(settings.default_timezone),
    profile_json: str | None = Form(None),
    template: UploadFile = File(...),
):
    try:
        start = datetime.fromisoformat(date_start)
        end = datetime.fromisoformat(date_end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date_start/date_end must be valid ISO datetimes") from exc
    if end <= start:
        raise HTTPException(status_code=422, detail="date_end must be later than date_start")

    suffix = Path(template.filename or "template.xlsx").suffix.lower()
    if suffix not in {".xlsx", ".xlsm"}:
        raise HTTPException(status_code=422, detail="Milestone 1 supports .xlsx and .xlsm templates")

    profile = DEFAULT_PROFILE
    if profile_json:
        try:
            profile = json.loads(profile_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="profile_json is not valid JSON") from exc

    run_id = uuid4().hex[:10]
    template_path = settings.output_path / f"template-{run_id}{suffix}"
    output_path = settings.output_path / f"report-{run_id}{suffix}"
    with template_path.open("wb") as target:
        shutil.copyfileobj(template.file, target)

    try:
        entries = clockify().detailed_entries(
            workspace_id=workspace_id,
            date_start=start,
            date_end=end,
            timezone=timezone,
            project_id=project_id,
            user_id=user_id,
        )
        if not entries:
            raise HTTPException(status_code=404, detail="Clockify returned no entries for this selection")
        result = generate_xlsx(
            template_path=template_path,
            output_path=output_path,
            entries=entries,
            profile=profile,
            employee_name=employee_name,
            project_name=project_name,
            period_start=start,
            period_end=end,
        )
    except ClockifyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ReportGenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    media = (
        "application/vnd.ms-excel.sheet.macroEnabled.12"
        if suffix == ".xlsm"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    filename = f"{project_name.replace(' ', '_')}_{start:%Y-%m-%d}_{end:%Y-%m-%d}{suffix}"
    return FileResponse(
        output_path,
        filename=filename,
        media_type=media,
        headers={"X-Report-Validation": result.model_dump_json()},
    )
