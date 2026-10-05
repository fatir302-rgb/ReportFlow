import { NextResponse } from "next/server";
import { currentAppUser } from "@/lib/session";
import { createDeliveryOAuthState } from "@/lib/oauth-state";
import { deliveryRedirectUri, microsoftDeliveryClient } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const user = await currentAppUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  try {
    const { clientId, tenantId } = microsoftDeliveryClient();
    const returnTo = new URL(request.url).searchParams.get("returnTo") || "/app/connections";
    const { state, codeChallenge } = createDeliveryOAuthState({ userId: user.id, provider: "outlook", returnTo });
    const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: deliveryRedirectUri("outlook"),
      response_type: "code",
      response_mode: "query",
      scope: "openid profile email offline_access User.Read Mail.Send",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      state,
    }).toString();
    return NextResponse.redirect(url);
  } catch (error) {
    const url = new URL("/app/connections", request.url);
    url.searchParams.set("error", error instanceof Error ? error.message : "Unable to start Microsoft connection");
    return NextResponse.redirect(url);
  }
}
