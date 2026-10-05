import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { readDeliveryOAuthState } from "@/lib/oauth-state";
import { exchangeGoogleDeliveryCode, getGoogleDeliveryProfile, saveDeliveryConnection } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateText = url.searchParams.get("state") || "";
  let returnTo = "/app/connections";
  try {
    const state = readDeliveryOAuthState(stateText, "gmail");
    returnTo = state.returnTo;
    const user = await currentAppUser();
    if (!user || user.id !== state.userId) throw new Error("Your ReportFlow session changed during Google connection.");
    const providerError = url.searchParams.get("error");
    if (providerError) throw new Error(url.searchParams.get("error_description") || providerError);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google did not return an authorization code");
    const tokens = await exchangeGoogleDeliveryCode(code, state.codeVerifier);
    const profile = await getGoogleDeliveryProfile(tokens.accessToken);
    saveDeliveryConnection({ userId: user.id, provider: "gmail", profile, tokens });
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("connected", "gmail");
    return NextResponse.redirect(destination);
  } catch (error) {
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("error", error instanceof Error ? error.message : "Google connection failed");
    return NextResponse.redirect(destination);
  }
}
