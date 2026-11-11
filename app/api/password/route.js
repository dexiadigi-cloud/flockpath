import { cookies } from "next/headers";
import { verifySession, changePassword } from "../../../lib/auth.mjs";

// Nov 4, 2026, signed-in password change (Mac pastor-role
// test item 3, first half). A pastor who can still sign in
// changes their password here, with the current password.
// A pastor who cannot sign in at all uses the local reset
// script named on the forgot-password page instead.
export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    changePassword(s.email, body.currentPassword, body.newPassword);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
