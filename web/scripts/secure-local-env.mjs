import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";

const envPath = path.resolve(".env.local");
const tempPath = `${envPath}.reportflow-tmp`;

if (!existsSync(envPath)) throw new Error(".env.local is missing; copy .env.example first");

const originalEnv = readFileSync(envPath, "utf8");
const values = new Map();
for (const line of originalEnv.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}

const weak = (value = "") => !value || value.startsWith("replace-with-") || value.length < 24;
const keys = ["AUTH_SECRET", "APP_ENCRYPTION_KEY", "REPORTFLOW_SCHEDULER_SECRET"];
const replacements = new Map(
  keys.filter((key) => weak(values.get(key))).map((key) => [key, randomBytes(48).toString("base64url")]),
);

if (!replacements.size) {
  console.log("Local secrets are already configured; no changes were made.");
  process.exit(0);
}

const oldEncryptionKey = values.get("APP_ENCRYPTION_KEY") || "";
const newEncryptionKey = replacements.get("APP_ENCRYPTION_KEY");
const configuredDb = values.get("REPORTFLOW_DB_PATH") || "./data/reportflow.sqlite";
const dbPath = path.resolve(configuredDb);
const db = existsSync(dbPath) ? new Database(dbPath) : null;
const originalCredentials = db
  ? db.prepare("SELECT id, credentials_enc FROM connections").all()
  : [];

function derivedKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function decrypt(payload, secret) {
  const [ivText, tagText, dataText] = payload.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("Invalid encrypted connector credential");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encrypt(plainText, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

let migratedCredentials = [];
if (newEncryptionKey && originalCredentials.length) {
  migratedCredentials = originalCredentials.map((row) => ({
    id: row.id,
    credentials_enc: encrypt(decrypt(row.credentials_enc, oldEncryptionKey), newEncryptionKey),
  }));
}

let updatedEnv = originalEnv;
for (const [key, value] of replacements) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (!pattern.test(updatedEnv)) throw new Error(`${key} is missing from .env.local`);
  updatedEnv = updatedEnv.replace(pattern, `${key}=${value}`);
}

const restoreCredentials = () => {
  if (!db || !migratedCredentials.length) return;
  const update = db.prepare("UPDATE connections SET credentials_enc = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of originalCredentials) update.run(row.credentials_enc, row.id);
  })();
};

try {
  writeFileSync(tempPath, updatedEnv, { encoding: "utf8", flag: "wx" });
  if (db && migratedCredentials.length) {
    const update = db.prepare("UPDATE connections SET credentials_enc = ? WHERE id = ?");
    db.transaction(() => {
      for (const row of migratedCredentials) update.run(row.credentials_enc, row.id);
    })();
  }
  try {
    copyFileSync(tempPath, envPath);
  } catch (error) {
    restoreCredentials();
    throw error;
  }
  console.log(`Configured ${replacements.size} local secret(s); migrated ${migratedCredentials.length} connector credential(s).`);
} finally {
  db?.close();
  if (existsSync(tempPath)) unlinkSync(tempPath);
}
