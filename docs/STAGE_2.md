# Stage 2 — App Foundation

Status: implemented scaffold.

## User flow

Login with Google or Microsoft -> Dashboard -> Connections -> Connect Clockify -> New Project -> Select Clockify workspace -> Select one or more Clockify projects -> Save -> Project detail.

## Data ownership

Every connection and app project belongs to one ReportFlow user. App projects are not hard-coded clients. A user can create any project name and map any number of Clockify source projects to it.

## Tables

- users
- auth_identities
- connections
- projects
- project_source_projects

## Security decisions

- OAuth provider secrets stay in environment variables.
- Clockify API keys are encrypted at rest with AES-256-GCM.
- Clockify API keys are never returned to the browser after storage.
- Clockify discovery requests are server-side.
- App login permissions remain separate from Gmail/Outlook delivery permissions.

## Next stage

Stage 3 attaches report definitions to a project: weekly/monthly/custom frequency, template upload, renderer/profile type, output type, and data filtering rules.
