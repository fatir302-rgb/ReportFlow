import { readFile } from "node:fs/promises";
import path from "node:path";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getConnectionById, updateConnectionCredentials } from "@/lib/db";
import { googleDeliveryClient, microsoftDeliveryClient, type OAuthTokenSet } from "@/lib/email-oauth";

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type OutgoingReportEmail = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  attachment?: EmailAttachment | null;
};

function decodeTokens(value: string): OAuthTokenSet {
  return JSON.parse(decryptSecret(value)) as OAuthTokenSet;
}

async function postForm(url: string, body: URLSearchParams) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `Token refresh failed (${response.status})`);
  }
  return payload;
}

async function refreshGoogle(tokens: OAuthTokenSet) {
  if (!tokens.refreshToken) throw new Error("Google connection has no refresh token");
  const { clientId, clientSecret } = googleDeliveryClient();
  const payload = await postForm("https://oauth2.googleapis.com/token", new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  }));
  return {
    ...tokens,
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : tokens.refreshToken,
    expiresAt: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : null,
    scope: payload.scope ? String(payload.scope) : tokens.scope,
    tokenType: payload.token_type ? String(payload.token_type) : tokens.tokenType,
  } satisfies OAuthTokenSet;
}

async function refreshMicrosoft(tokens: OAuthTokenSet) {
  if (!tokens.refreshToken) throw new Error("Microsoft connection has no refresh token");
  const { clientId, clientSecret, tenantId } = microsoftDeliveryClient();
  const payload = await postForm(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
    scope: "openid profile email offline_access User.Read Mail.Send",
  }));
  return {
    ...tokens,
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : tokens.refreshToken,
    expiresAt: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : null,
    scope: payload.scope ? String(payload.scope) : tokens.scope,
    tokenType: payload.token_type ? String(payload.token_type) : tokens.tokenType,
  } satisfies OAuthTokenSet;
}

async function validAccessToken(userId: string, connection: any) {
  let tokens = decodeTokens(connection.credentials_enc);
  const shouldRefresh = !tokens.expiresAt || tokens.expiresAt <= Date.now() + 60_000;
  if (shouldRefresh) {
    tokens = connection.provider === "gmail" ? await refreshGoogle(tokens) : await refreshMicrosoft(tokens);
    updateConnectionCredentials({
      userId,
      connectionId: connection.id,
      credentialsEnc: encryptSecret(JSON.stringify(tokens)),
    });
  }
  return tokens.accessToken;
}

function addressList(values: string[] | undefined) {
  return (values || []).map((value) => value.trim()).filter(Boolean);
}

function mimeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function buildGmailMime(message: OutgoingReportEmail) {
  const boundary = `reportflow_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const lines = [
    `To: ${addressList(message.to).join(", ")}`,
    ...(addressList(message.cc).length ? [`Cc: ${addressList(message.cc).join(", ")}`] : []),
    ...(addressList(message.bcc).length ? [`Bcc: ${addressList(message.bcc).join(", ")}`] : []),
    `Subject: ${mimeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.bodyText,
  ];
  if (message.attachment) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${message.attachment.contentType}; name="${mimeHeader(message.attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${mimeHeader(message.attachment.filename)}"`,
      "",
      message.attachment.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function sendGmail(accessToken: string, message: OutgoingReportEmail) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: buildGmailMime(message) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Gmail send failed (${response.status})`);
  return { providerMessageId: payload?.id ? String(payload.id) : null, accepted: true };
}

function graphRecipients(values: string[] | undefined) {
  return addressList(values).map((address) => ({ emailAddress: { address } }));
}

async function sendOutlook(accessToken: string, message: OutgoingReportEmail) {
  const attachments = message.attachment ? [{
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: message.attachment.filename,
    contentType: message.attachment.contentType,
    contentBytes: message.attachment.content.toString("base64"),
  }] : undefined;
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "Text", content: message.bodyText },
        toRecipients: graphRecipients(message.to),
        ccRecipients: graphRecipients(message.cc),
        bccRecipients: graphRecipients(message.bcc),
        ...(attachments ? { attachments } : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || `Outlook send failed (${response.status})`);
  }
  return { providerMessageId: null, accepted: true };
}

export async function sendWithDeliveryConnection(input: {
  userId: string;
  connectionId: string;
  message: OutgoingReportEmail;
}) {
  const connection = getConnectionById(input.userId, input.connectionId);
  if (!connection || (connection.provider !== "gmail" && connection.provider !== "outlook")) {
    throw new Error("Delivery connection not found");
  }
  const accessToken = await validAccessToken(input.userId, connection);
  const result = connection.provider === "gmail"
    ? await sendGmail(accessToken, input.message)
    : await sendOutlook(accessToken, input.message);
  return { ...result, provider: connection.provider as "gmail" | "outlook", sender: connection.display_name as string };
}

export async function attachmentFromFile(filePath: string, filename: string, contentType: string): Promise<EmailAttachment> {
  const resolved = path.resolve(filePath);
  return { filename, contentType, content: await readFile(resolved) };
}
