# Stage 3 — Weekly and Monthly Report Configuration

Stage 3 attaches report definitions to the dynamic projects created in Stage 2.

## What is implemented

Each project has exactly two report slots for the MVP:

- Weekly
- Monthly

Each report is independent and stores:

- enabled/disabled state
- active Excel template
- template upload history/version number
- desired output format (`xlsx`, `xlsm`, or `pdf`)
- filename pattern
- source-data mode (`all` mapped Clockify projects or a selected subset)

Weekly and monthly can use completely different templates and source-data rules.

## Template storage

Uploads are stored outside the public web tree under `REPORTFLOW_TEMPLATE_DIR` (default `./data/templates`).
Only `.xlsx` and `.xlsm` templates are accepted at this stage, with a 15 MB limit and a basic workbook/ZIP signature check.

The database never overwrites the previous template record. A replacement upload creates the next version and makes it active. Rollback UI is intentionally deferred to Stage 8, but the history foundation already exists.

## Output formats

The selected desired output format can be:

- XLSX
- XLSM
- PDF

The current Python engine generates XLSX/XLSM. PDF is stored as a desired output setting now; conversion is activated with the execution/delivery pipeline before production scheduling.

## Data selection

A report can either:

1. use all Clockify projects already mapped to the parent ReportFlow project, or
2. use only selected mapped Clockify projects.

This avoids hard-coding any client/project names and allows weekly/monthly to have different source scopes.

## UI

Project detail now shows:

- Weekly report — Configure/Edit
- Monthly report — Configure/Edit

The global Reports page shows both report types for every project.

## Deliberately not in Stage 3

- schedule/day/shift timing
- month-end night-shift calculation
- Gmail/Outlook delivery
- recipient lists and email text
- live report execution from arbitrary uploaded templates
- AI template interpretation
- rollback controls

Those are layered on after this configuration foundation instead of being mixed into template storage.
