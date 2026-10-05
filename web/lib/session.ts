import { auth } from "@/auth";
import { ensureDevUser, getUserByEmail } from "@/lib/db";
import { isDevAuthBypassEnabled } from "@/lib/runtime-config";
import type { AppUser } from "@/lib/types";

export async function currentAppUser(): Promise<AppUser | null> {
  if (isDevAuthBypassEnabled()) return ensureDevUser();
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return getUserByEmail(email);
}
