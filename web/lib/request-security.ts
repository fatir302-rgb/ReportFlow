import "server-only";
import { timingSafeEqual } from "node:crypto";


export function matchesSecret(provided: string | null | undefined, expected: string | null | undefined) {
  if (!provided || !expected) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}
