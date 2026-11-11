import { cookies } from "next/headers";
import { signInOrCreate, signOut, getPastor } from "../../../lib/auth.mjs";

export async function POST(request) {
  // Nov 3, 2026, agent-test fix W12: every failure used to
  // return 401, including malformed JSON and validation
  // errors. A malformed request is not an authentication
  // failure: 400 for malformed or invalid input, 401 only
  // for a wrong password.
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "That sign-in request was not valid." }, { status: 400 });
  }
  try {
    const session = signInOrCreate(body);
    const store = await cookies();
    store.set("flockpath_session", session.token, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60,
    });
    const pastor = getPastor(session.email);
    return Response.json({ ok: true, email: session.email, name: session.name, church: session.church, denomination: pastor?.denomination ?? "non-denominational" });
  } catch (e) {
    const validation = ["Enter a valid email.", "Password must be at least 8 characters.", "Name and church are required."];
    // Nov 4, 2026, lockout: a locked account is not a wrong
    // password, it is a rate limit. 429 says so plainly.
    const status = validation.includes(e.message) ? 400 : String(e.message).startsWith("Too many wrong passwords") ? 429 : 401;
    return Response.json({ ok: false, error: e.message }, { status });
  }
}

export async function DELETE() {
  const store = await cookies();
  signOut(store.get("flockpath_session")?.value);
  store.set("flockpath_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return Response.json({ ok: true });
}
