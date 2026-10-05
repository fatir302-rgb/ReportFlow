import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const production = process.argv.includes("--production");
const envFile = ".env.local";

if (!existsSync(envFile)) {
  console.error(`${envFile} is missing; copy .env.example before starting ReportFlow.`);
  process.exitCode = 1;
} else {
  const values = new Map();
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }

  const failures = [];
  for (const key of ["AUTH_SECRET", "APP_ENCRYPTION_KEY", "REPORTFLOW_SCHEDULER_SECRET"]) {
    const value = values.get(key) || "";
    if (!value || value.startsWith("replace-with-") || value.length < 24) {
      failures.push(`${key} must be replaced with a unique random value of at least 24 characters.`);
    }
  }

  if (production && values.get("DEV_BYPASS_AUTH") === "true") {
    failures.push("DEV_BYPASS_AUTH must be false in production.");
  }
  if (production && values.get("AUTH_URL") !== "http://localhost:3000") {
    failures.push("AUTH_URL must be http://localhost:3000 for the local desktop build.");
  }
  if (production && values.get("REPORTFLOW_BASE_URL") !== "http://localhost:3000") {
    failures.push("REPORTFLOW_BASE_URL must be http://localhost:3000 for local OAuth callbacks.");
  }

  if (failures.length) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`${production ? "Production" : "Local"} environment safety checks passed.`);
  }

  const pairConfigured = (first, second) => Boolean(values.get(first) && values.get(second));
  const googleDeliveryConfigured = pairConfigured("GOOGLE_DELIVERY_CLIENT_ID", "GOOGLE_DELIVERY_CLIENT_SECRET")
    || pairConfigured("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET");
  const microsoftDeliveryConfigured = pairConfigured("MICROSOFT_DELIVERY_CLIENT_ID", "MICROSOFT_DELIVERY_CLIENT_SECRET")
    || pairConfigured("AUTH_MICROSOFT_ENTRA_ID_ID", "AUTH_MICROSOFT_ENTRA_ID_SECRET");
  const configuredPython = values.get("REPORTFLOW_PYTHON") || "";
  const repositoryRoot = path.resolve(process.cwd(), "..");
  const localPython = process.platform === "win32"
    ? path.join(repositoryRoot, ".venv", "Scripts", "python.exe")
    : path.join(repositoryRoot, ".venv", "bin", "python");
  const python = configuredPython || (existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
  const pythonProbe = spawnSync(python, ["-c", "import openpyxl, httpx"], { encoding: "utf8", windowsHide: true });
  const windowsSitePackages = path.join(repositoryRoot, ".venv", "Lib", "site-packages");
  const localPackagesReady = process.platform === "win32"
    && existsSync(path.join(windowsSitePackages, "openpyxl"))
    && existsSync(path.join(windowsSitePackages, "httpx"));
  const reportGenerationReady = localPackagesReady || pythonProbe.status === 0;

  console.log("Feature readiness:");
  console.log(`- Report generation: ${reportGenerationReady ? "ready" : "unavailable (install the root Python requirements)"}`);
  console.log(`- Google delivery OAuth: ${googleDeliveryConfigured ? "configured" : "not configured"}`);
  console.log(`- Microsoft delivery OAuth: ${microsoftDeliveryConfigured ? "configured" : "not configured"}`);
  console.log(`- AI assistant: ${values.get("OPENAI_API_KEY") ? "shared server fallback configured" : "users can connect their own key from the Assistant page"}`);
}
