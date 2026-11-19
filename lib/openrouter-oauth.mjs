// Nov 17, 2026, v58 (OpenRouter OAuth sign-in, PKCE):
// The pastor can sign in with OpenRouter instead of pasting a
// key. Verified from OpenRouter's own docs
// (openrouter.ai/docs/guides/overview/auth/oauth, updated
// 2026-11-16, read Nov 17, 2026) -- no client ID, no client
// secret, no registration. The flow:
//   1. This app generates a random code_verifier, derives
//      code_challenge = base64url(SHA-256(verifier)), and
//      sends the pastor to
//      https://openrouter.ai/auth?callback_url=<url>
//        &code_challenge=<challenge>&code_challenge_method=S256
//        &key_label=Flockpath&state=<random>
//      Localhost callbacks are supported on ANY port, so the
//      local app's own origin works as the callback URL.
//      The optional `state` param is returned unchanged on
//      the callback and is used here as the CSRF check.
//   2. OpenRouter redirects back to the callback URL with a
//      `code` (single-use, expires after 10 minutes).
//   3. This app exchanges it server-side:
//      POST https://openrouter.ai/api/v1/auth/keys
//      { code, code_verifier, code_challenge_method: "S256" }
//      -> { "key": "sk-or-v1-..." }
// The exchange yields a long-lived API key, not an expiring
// access token, so there is no refresh step. The key is
// stored exactly where a pasted key goes
// (pastors.openrouterApiKey via setOpenRouterKey), so the
// model route, masking, and 401/402 handling apply unchanged.
// The key is NEVER in a log, NEVER in a URL, and NEVER in
// browser storage: OpenRouter's own docs warn against
// persisting it in localStorage/sessionStorage/IndexedDB,
// so the verifier lives only in a server-side pending map
// (10-minute expiry) keyed by the state token, and the state
// token itself rides in an httpOnly cookie the browser
// cannot read with JavaScript. The key-paste flow stays as
// the fallback; OAuth only adds a sign-in path.
import { randomBytes, createHash } from "node:crypto";

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000; // OpenRouter: codes expire after 10 minutes.

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl({ origin, challenge, state }) {
  const callbackUrl = `${origin}/api/model/openrouter-oauth`;
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: "S256",
    key_label: "Flockpath",
    state,
  });
  return `${OPENROUTER_AUTH_URL}?${params.toString()}`;
}

// Pending flows: state token -> { verifier, expiresAt }.
// In-memory only, single-user local app; a restart just means
// the pastor starts sign-in again. Nothing here is a secret
// that leaves this computer: the verifier is the PKCE proof,
// and it is consumed (deleted) on first use.
const pending = new Map();

export function createPendingFlow() {
  const state = base64url(randomBytes(24));
  const { verifier, challenge } = createPkcePair();
  pending.set(state, { verifier, expiresAt: Date.now() + OAUTH_CODE_TTL_MS });
  return { state, challenge };
}

export function consumePendingFlow(state) {
  if (!state) return null;
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.verifier;
}

export async function exchangeCodeForKey({ code, codeVerifier }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(OPENROUTER_KEYS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: String(code ?? ""),
        code_verifier: String(codeVerifier ?? ""),
        code_challenge_method: "S256",
      }),
      signal: controller.signal,
    });
    if (res.status === 403) {
      // Docs: 403 Invalid code or code_verifier, or 403
      // Authorization code expired (10 minutes). Either way
      // the code is dead; the pastor starts sign-in again.
      throw new Error("That sign-in link expired. Sign in with OpenRouter again.");
    }
    if (res.status === 400) {
      throw new Error("OpenRouter did not accept the sign-in. Sign in with OpenRouter again.");
    }
    if (!res.ok) {
      throw new Error("OpenRouter didn't answer. Try signing in again in a little while.");
    }
    const data = await res.json().catch(() => ({}));
    const key = typeof data?.key === "string" ? data.key.trim() : "";
    if (!key) throw new Error("OpenRouter did not return a key. Sign in with OpenRouter again.");
    return key;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("OpenRouter didn't answer. Try signing in again in a little while.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
