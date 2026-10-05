import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type DeliveryOAuthProvider = "gmail" | "outlook";

type OAuthStatePayload = {
  userId: string;
  provider: DeliveryOAuthProvider;
  returnTo: string;
  codeVerifier: string;
  expiresAt: number;
};

export function createDeliveryOAuthState(input: {
  userId: string;
  provider: DeliveryOAuthProvider;
  returnTo?: string;
}) {
  const requestedReturnTo = input.returnTo?.trim();
  const returnTo = requestedReturnTo && /^\/(?![\\/])/.test(requestedReturnTo)
    ? requestedReturnTo
    : "/app/connections";
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const payload: OAuthStatePayload = {
    userId: input.userId,
    provider: input.provider,
    returnTo,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60_000,
  };
  return { state: encryptSecret(JSON.stringify(payload)), codeChallenge };
}

export function readDeliveryOAuthState(state: string, expectedProvider: DeliveryOAuthProvider): OAuthStatePayload {
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(decryptSecret(state)) as OAuthStatePayload;
  } catch {
    throw new Error("Invalid OAuth state");
  }
  if (payload.provider !== expectedProvider) throw new Error("OAuth provider mismatch");
  if (!payload.userId || !payload.codeVerifier || !payload.expiresAt || payload.expiresAt < Date.now()) {
    throw new Error("OAuth state expired");
  }
  return payload;
}
