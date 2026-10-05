export function isDevAuthBypassEnabled(): boolean {
  const enabled = process.env.DEV_BYPASS_AUTH === "true";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error("DEV_BYPASS_AUTH must be false in production");
  }
  return enabled;
}
