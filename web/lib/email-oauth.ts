import { encryptSecret } from "@/lib/crypto";
import { saveConnection } from "@/lib/db";
import type { DeliveryOAuthProvider } from "@/lib/oauth-state";

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
  tokenType: string | null;
};

function baseUrl() {
  return (process.env.REPORTFLOW_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function deliveryRedirectUri(provider: DeliveryOAuthProvider) {
  return `${baseUrl()}/api/connections/${provider}/callback`;
}

export function googleDeliveryClient() {
  const clientId = process.env.GOOGLE_DELIVERY_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.GOOGLE_DELIVERY_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google delivery OAuth is not configured");
  return { clientId, clientSecret };
}

export function microsoftDeliveryClient() {
  const clientId = process.env.MICROSOFT_DELIVERY_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.MICROSOFT_DELIVERY_CLIENT_SECRET || process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  const tenantId = process.env.MICROSOFT_DELIVERY_TENANT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || "common";
  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && "MICROSOFT_DELIVERY_CLIENT_ID",
      !clientSecret && "MICROSOFT_DELIVERY_CLIENT_SECRET",
    ].filter(Boolean);
    throw new Error(`Microsoft Outlook delivery needs Entra OAuth credentials. Set ${missing.join(" and ")} in web/.env.local, then restart the development server.`);
  }
  return { clientId, clientSecret, tenantId };
}

function parseTokenResponse(payload: any): OAuthTokenSet {
  if (!payload?.access_token) throw new Error(payload?.error_description || payload?.error || "OAuth token exchange failed");
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    expiresAt: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : null,
    scope: payload.scope ? String(payload.scope) : null,
    tokenType: payload.token_type ? String(payload.token_type) : null,
  };
}

async function postForm(url: string, body: URLSearchParams) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || `OAuth token endpoint returned ${response.status}`);
  return parseTokenResponse(payload);
}

export async function exchangeGoogleDeliveryCode(code: string, codeVerifier: string) {
  const { clientId, clientSecret } = googleDeliveryClient();
  return postForm("https://oauth2.googleapis.com/token", new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: deliveryRedirectUri("gmail"),
  }));
}

export async function exchangeMicrosoftDeliveryCode(code: string, codeVerifier: string) {
  const { clientId, clientSecret, tenantId } = microsoftDeliveryClient();
  return postForm(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: deliveryRedirectUri("outlook"),
    scope: "openid profile email offline_access User.Read Mail.Send",
  }));
}

export async function getGoogleDeliveryProfile(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.email) throw new Error("Unable to read the connected Google account");
  return { id: String(payload.sub || payload.email), email: String(payload.email), name: payload.name ? String(payload.name) : null };
}

export async function getMicrosoftDeliveryProfile(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  const email = payload?.mail || payload?.userPrincipalName;
  if (!response.ok || !email) throw new Error("Unable to read the connected Microsoft account");
  return { id: String(payload.id || email), email: String(email), name: payload.displayName ? String(payload.displayName) : null };
}

export function saveDeliveryConnection(input: {
  userId: string;
  provider: DeliveryOAuthProvider;
  profile: { id: string; email: string; name: string | null };
  tokens: OAuthTokenSet;
}) {
  if (!input.tokens.refreshToken) {
    throw new Error("The provider did not return an offline refresh token. Reconnect and approve offline access.");
  }
  return saveConnection({
    userId: input.userId,
    provider: input.provider,
    displayName: input.profile.email,
    credentialsEnc: encryptSecret(JSON.stringify(input.tokens)),
    metadata: {
      accountId: input.profile.id,
      email: input.profile.email,
      name: input.profile.name,
      scope: input.tokens.scope,
    },
  });
}
