import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { readDeliveryOAuthState } from "@/lib/oauth-state";
import { exchangeMicrosoftDeliveryCode, getMicrosoftDeliveryProfile, saveDeliveryConnection } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateText = url.searchParams.get("state") || "";
  let returnTo = "/app/connections";
  try {
    const state = readDeliveryOAuthState(stateText, "outlook");
    returnTo = state.returnTo;
    const user = await currentAppUser();
    if (!user || user.id !== state.userId) throw new Error("Your ReportFlow session changed during Microsoft connection.");
    const providerError = url.searchParams.get("error");
    if (providerError) throw new Error(url.searchParams.get("error_description") || providerError);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Microsoft did not return an authorization code");
    const tokens = await exchangeMicrosoftDeliveryCode(code, state.codeVerifier);
    const profile = await getMicrosoftDeliveryProfile(tokens.accessToken);
    saveDeliveryConnection({ userId: user.id, provider: "outlook", profile, tokens });
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("connected", "outlook");
    return NextResponse.redirect(destination);
  } catch (error) {
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("error", error instanceof Error ? error.message : "Microsoft connection failed");
    return NextResponse.redirect(destination);
  }
}
