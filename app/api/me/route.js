import { cookies } from "next/headers";
import { verifySession, getPastor, setDenomination } from "../../../lib/auth.mjs";
import { denominationMessage } from "../../../lib/denominations.mjs";

// Nov 2, 2026, denomination setting: the signed-in pastor's own
// setting, read and changed here. The setting lives only in the
// local auth database on the pastor's own computer. It is never
// sent anywhere else, and it never appears in a pack or PDF.

export async function GET() {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const pastor = getPastor(s.email);
  if (!pastor) return Response.json({ ok: false, error: "Pastor not found." }, { status: 404 });
  return Response.json({ ok: true, ...pastor });
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const pastor = setDenomination(s.email, body.denomination);
    return Response.json({ ok: true, ...pastor, message: denominationMessage(pastor.denomination) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
