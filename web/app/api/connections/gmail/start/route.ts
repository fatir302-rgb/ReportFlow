import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { createDeliveryOAuthState } from "@/lib/oauth-state";
import { deliveryRedirectUri, googleDeliveryClient } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  try {
    const { clientId } = googleDeliveryClient();
    const returnTo = new URL(request.url).searchParams.get("returnTo") || "/app/connections";
    const { state, codeChallenge } = createDeliveryOAuthState({ userId: user.id, provider: "gmail", returnTo });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: deliveryRedirectUri("gmail"),
      response_type: "code",
      scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    }).toString();
    return NextResponse.redirect(url);
  } catch (error) {
    const url = new URL("/app/connections", request.url);
    url.searchParams.set("error", error instanceof Error ? error.message : "Unable to start Google connection");
    return NextResponse.redirect(url);
  }
}
