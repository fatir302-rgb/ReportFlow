# ReportFlow Windows launcher

`ReportFlow.exe` is the personal-PC launcher. Keep it in the repository root beside the `web` folder.

- Double-click it to start the production Next.js server silently and open Chrome at `http://localhost:3000/app`.
- Double-click the tray icon to reopen ReportFlow.
- Right-click the tray icon and choose **Stop ReportFlow and exit** when finished.
- It uses the existing `web/.env.local`, `web/data`, Node.js installation, repository `.venv`, and report engine files. Secrets are not compiled into the executable.

Rebuild after application changes from `web` with:

```powershell
npm run desktop:build
```

This launcher is intentionally for the current PC. A future distributable installer must bundle the production server, native `better-sqlite3` binary, Python runtime/dependencies, templates, and a first-run configuration flow.
