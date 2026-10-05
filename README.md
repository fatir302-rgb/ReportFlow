# ReportFlow MVP — Stages 1–8

This repository contains the Python report engine and the Stage 2–8 Next.js application for reporting automation.

## Stage 2 web application

The repository now also contains `web/`, the Stage 2 multi-user application shell. It adds Google/Microsoft authentication wiring, encrypted per-user Clockify connections, and dynamic app projects that can map to any number of Clockify projects. See `web/README.md` and `docs/STAGE_2.md`.



## Stage 3 web application — weekly + monthly reports

The Stage 2 app now includes Stage 3 report configuration. Every dynamic project has independent **Weekly** and **Monthly** report slots. Each can upload its own `.xlsx`/`.xlsm` template, choose XLSX/XLSM/PDF as the desired output, set a filename pattern, and use either all mapped Clockify projects or a selected subset. Replacement templates are stored as new internal versions rather than overwriting history. See `docs/STAGE_3.md`.


## Stage 4 web application — shift-aware scheduling

Stage 4 is implemented. Weekly and Monthly report configurations can now be scheduled independently using an IANA timezone, business-week end day, shift start/end, automatic overnight handling, post-shift delay, Test/Production mode, and retry policy. A deduplicated durable queue stores reporting periods plus exact Clockify source timestamps. See `docs/STAGE_4.md`.

## What works now

- Connect to Clockify using an API key stored in `.env`.
- Read the authenticated Clockify user, workspaces and projects.
- Pull a detailed Clockify report for a date range, project and optional user.
- Normalize Clockify entries into a stable internal format.
- Populate an existing `.xlsx` or `.xlsm` template using a configurable mapping profile.
- Validate that source duration equals generated-report duration.
- Return the completed spreadsheet as a downloadable file.
- Generate a demo spreadsheet without any Clockify credentials, so the report engine can be tested immediately.

## Architecture foundation

The original Stage 1 milestone established the critical data path:

`Clockify -> normalized entries -> template -> validation -> XLSX/XLSM`

The web application now builds scheduling, Gmail/Outlook delivery, multi-user isolation, operational history, and governed AI configuration on that engine.

## Setup on Windows

1. Install Python 3.11+.
2. Open PowerShell in this folder.
3. Create a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

4. Install packages:

```powershell
pip install -r requirements-dev.txt
```

5. Create your local environment file:

```powershell
Copy-Item .env.example .env
```

6. Add your Clockify API key to `.env` when you are ready:

```env
CLOCKIFY_API_KEY=your_key_here
```

Do not send or commit your API key.

7. Run the server:

```powershell
uvicorn app.main:app --reload
```

8. Open:

`http://127.0.0.1:8000/docs`

FastAPI gives us a temporary test interface here. A proper dashboard comes later.

## First test — no Clockify required

In `/docs`, open:

`POST /api/reports/demo`

Click **Try it out** and **Execute**. It generates a real XLSX using demo time entries and validates the total hours.

## Clockify test flow

After configuring your key:

1. `GET /api/clockify/me`
2. `GET /api/clockify/workspaces`
3. Copy a workspace ID.
4. `GET /api/clockify/workspaces/{workspace_id}/projects`
5. Copy the project ID you want to report on.
6. Use `POST /api/reports/clockify` and upload your template.

Important fields:

- `workspace_id`: Clockify workspace ID.
- `project_id`: Clockify project ID.
- `user_id`: optional; useful when a workspace has multiple users.
- `date_start`, `date_end`: ISO datetimes including offset where possible.
- `timezone`: defaults to `Asia/Karachi`.
- `profile_json`: optional mapping that tells the report engine where each field goes.
- `template`: your `.xlsx` or `.xlsm` example report.

## Template mapping

The default mapping is in:

`config/report_profile.example.json`

Example:

```json
{
  "sheet": "Timesheet",
  "data_start_row": 8,
  "columns": {
    "date": "A",
    "project": "B",
    "description": "C",
    "start": "D",
    "end": "E",
    "duration": "F"
  },
  "metadata": {
    "employee_name": "B2",
    "project_name": "B3",
    "period": "B4",
    "total_hours": "F5"
  }
}
```

When a real example report is provided, this mapping will be customized to match that report. Later the AI template analyzer will propose this mapping automatically instead of requiring manual configuration.

## Validation rule

The engine calculates total source seconds from the normalized Clockify entries and compares that with the seconds written into the report. A mismatch raises an error instead of silently producing an invalid report.

Later we will expand validation to include dates, record counts, duplicates, missing project names and workbook-specific formulas.

## Tests

```powershell
pytest -q
cd web
npm test
npm run lint
npm run build
```

## Current product roadmap

Stages 1–8 are implemented in the MVP repository. The AI assistant drafts changes, and the Stage 8 governance layer validates, tests, approves, versions, applies and can roll them back non-destructively. See `docs/ROADMAP.md` for the maintained stage breakdown.

## Security rule

Secrets such as Clockify API keys and email OAuth tokens must never be stored in report templates, frontend code, prompts or source control. Production credentials will be encrypted at rest.

## Milestone 1.1 - real client templates

The MVP now supports multiple report renderer types instead of assuming every client has the same spreadsheet layout.

Current saved client configuration:

- `atm_link / weekly` -> flat detailed table renderer
- `atm_link / monthly` -> calendar-style monthly timesheet renderer

Useful endpoints:

- `GET /api/clients` - list configured clients/report types
- `GET /api/clients/atm_link` - inspect the saved client configuration
- `POST /api/reports/client/atm_link/weekly` - generate the saved weekly format
- `POST /api/reports/client/atm_link/monthly` - generate the saved monthly format

The saved-client endpoint accepts an optional `project_ids_json` array. This keeps data selection independent from the visual report format, so each client can later define which Clockify projects are included without changing the renderer.

See `docs/REAL_TEMPLATE_FINDINGS.md` for the reverse-engineered structure of the supplied real templates.

## Stage 5 — Gmail + Outlook delivery

Stage 5 adds separate Gmail and Microsoft Outlook delivery connections, per-report recipients and email templates, token refresh, attachment sending, test-mode suppression, and duplicate-send protection.

See `docs/STAGE_5.md` and `web/.env.example` for the OAuth callbacks and environment variables.

## Stage 6 — Operations / run history

Stage 6 adds the user-facing Activity console on top of the scheduler, artifact and delivery records. Users can filter run history, inspect one run in detail, securely download its generated report, manually retry a failed generation run, and explicitly resend a completed Production report. Automatic duplicate-send protection remains intact because human resends are recorded in a separate resend history.

See `docs/STAGE_6.md`.


## Stage 7 — Controlled AI configuration assistant

Stage 7 adds the in-app ReportFlow Assistant. It can answer configuration questions and translate natural-language requests into structured draft changes for projects, weekly/monthly report settings, schedules, delivery, Clockify source mappings and template requests. The assistant receives a sanitized snapshot with no connector credentials or OAuth tokens and has no code path that applies changes to Production.

See `docs/STAGE_7.md`.

## Stage 8 — Governance, versioning and rollback

Stage 8 completes the controlled AI change loop. AI proposals now use canonical configuration paths and must pass deterministic stale-state validation plus a Test & Preview dry-run before approval. Approval is separate from Production application. Applying creates an immutable project configuration version and an audit event. Restoring an older version creates a new version rather than deleting or rewriting history.

See `docs/STAGE_8.md`.
