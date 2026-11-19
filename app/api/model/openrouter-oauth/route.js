import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySession, setOpenRouterKey } from "../../../../lib/auth.mjs";
import {
  buildAuthorizeUrl,
  createPendingFlow,
  consumePendingFlow,
  exchangeCodeForKey,
  OAUTH_CODE_TTL_MS,
} from "../../../../lib/openrouter-oauth.mjs";

// Nov 17, 2026, v58 (OpenRouter OAuth sign-in, PKCE):
// GET ?start=1 begins the flow: signed-in pastor only, a
// random state + PKCE challenge are made server-side, the
// state rides in an httpOnly cookie, and the pastor is
// redirected to openrouter.ai/auth. OpenRouter sends them
// back here with ?code=...&state=..., this route exchanges
// the code for an API key (server-side, so the key never
// touches the browser except as a masked hint later) and
// stores it via setOpenRouterKey, exactly where a pasted
// key goes. Then it redirects to /packs, where the settings
// show the success state. The key is never logged and never
// put in a URL. Errors redirect to /packs with a plain
// ?openrouter=... flag the settings read; the paste flow
// stays untouched as the fallback.

const STATE_COOKIE = "flockpath_or_oauth_state";

function packsUrl(request, flag, reason) {
  const url = new URL("/packs", request.url);
  url.searchParams.set("openrouter", flag);
  if (reason) url.searchParams.set("reason", reason);
  return url;
}

export async function GET(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  const params = request.nextUrl.searchParams;

  // Step 1: start the flow.
  if (params.get("start") === "1") {
    if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
    const { state, challenge } = createPendingFlow();
    const origin = request.nextUrl.origin;
    const authorizeUrl = buildAuthorizeUrl({ origin, challenge, state });
    const res = NextResponse.redirect(authorizeUrl);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(OAUTH_CODE_TTL_MS / 1000),
    });
    return res;
  }

  // OpenRouter sends the pastor back with ?code= and ?state=.
  // A denial comes back as ?error= instead (docs: state is
  // not returned on denial).
  if (params.get("error")) {
    return NextResponse.redirect(packsUrl(request, "denied"));
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return NextResponse.redirect(packsUrl(request, "error", "missing"));
  }
  if (!s) {
    // The Flockpath session is gone (signed out mid-flow, or
    // the browser came back without it). Nothing is exchanged;
    // the pastor signs in to Flockpath and starts again.
    return NextResponse.redirect(packsUrl(request, "error", "session"));
  }
  // CSRF check: the state in the URL must match the state in
  // the httpOnly cookie set when the flow started, and the
  // server-side pending entry must still exist (10 minutes).
  if (store.get(STATE_COOKIE)?.value !== state) {
    return NextResponse.redirect(packsUrl(request, "error", "state"));
  }
  const verifier = consumePendingFlow(state);
  if (!verifier) {
    return NextResponse.redirect(packsUrl(request, "error", "expired"));
  }
  let key;
  try {
    key = await exchangeCodeForKey({ code, codeVerifier: verifier });
  } catch (e) {
    return NextResponse.redirect(packsUrl(request, "error", "exchange"));
  }
  try {
    setOpenRouterKey(s.email, key);
  } catch {
    return NextResponse.redirect(packsUrl(request, "error", "save"));
  }
  const res = NextResponse.redirect(packsUrl(request, "connected"));
  res.cookies.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
