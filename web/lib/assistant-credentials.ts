import { decryptSecret } from "@/lib/crypto";
import { getConnection } from "@/lib/db";

/** Resolve a user's encrypted key first, then fall back to an administrator-managed key. */
export function assistantApiKey(userId: string) {
  const personalConnection = getConnection(userId, "openai");
  return personalConnection ? decryptSecret(personalConnection.credentials_enc) : process.env.OPENAI_API_KEY;
}
