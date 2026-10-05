import { redirect } from "next/navigation";
import { currentAppUser } from "@/lib/session";
import type { AppUser } from "@/lib/types";

export async function requireAppUser(): Promise<AppUser> {
  const user = await currentAppUser();
  if (!user) redirect("/login");
  return user;
}
