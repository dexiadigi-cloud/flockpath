import { cookies } from "next/headers";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifySession, setLogo } from "../../../lib/auth.mjs";

// Nov 3, 2026, church logo upload: optional, pastor-chosen.
// A PNG or JPEG up to 2 MB, stored under public/church-logos
// on the pastor's own computer, recorded on the pastor row,
// and printed on future pack covers. Removing the logo clears
// the row and deletes the file. Nothing is sent anywhere else.

const DIR = path.join(process.cwd(), "public", "church-logos");
const MAX_BYTES = 2 * 1024 * 1024;

function slug(email) {
  return String(email).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "church";
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, error: "No upload received." }, { status: 400 });
  mkdirSync(DIR, { recursive: true });
  const base = slug(s.email);
  const clearOld = () => {
    for (const f of readdirSync(DIR)) {
      if (f === `${base}.png` || f === `${base}.jpg` || f === `${base}.jpeg`) {
        try { unlinkSync(path.join(DIR, f)); } catch {}
      }
    }
  };
  if (form.get("remove") === "1") {
    clearOld();
    const pastor = setLogo(s.email, null);
    return Response.json({ ok: true, ...pastor });
  }
  // Nov 3, 2026, built-in demo samples: a pastor testing the
  // tool can pick a sample logo instead of uploading one. The
  // sample is COPIED to the pastor's own file, so it behaves
  // exactly like an upload (removable, replaceable). Only
  // files named sample-* in this directory are eligible, and
  // the name is validated, so no other path can be picked.
  const sample = String(form.get("sample") ?? "");
  if (sample) {
    if (!/^sample-[A-Za-z0-9._-]+\.png$/i.test(sample)) return Response.json({ ok: false, error: "Unknown sample logo." }, { status: 400 });
    const src = path.join(DIR, sample);
    if (!existsSync(src)) return Response.json({ ok: false, error: "Unknown sample logo." }, { status: 404 });
    clearOld();
    const name = `${base}.png`;
    copyFileSync(src, path.join(DIR, name));
    const pastor = setLogo(s.email, `church-logos/${name}`);
    return Response.json({ ok: true, ...pastor });
  }
  const file = form.get("logo");
  if (!file || typeof file.arrayBuffer !== "function") return Response.json({ ok: false, error: "Choose a PNG or JPEG logo." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) return Response.json({ ok: false, error: "Logo must be under 2 MB." }, { status: 400 });
  // Nov 3, 2026, agent-test fix W13: uploads were trusted by
  // extension and client MIME type only, so a non-image
  // renamed to .png passed the gate and failed later, at PDF
  // build time, with a Typst error. The file's own magic
  // bytes now decide: PNG signature or JPEG SOI marker, or
  // the upload is rejected here with a plain message.
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const isJpg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isPng && !isJpg) return Response.json({ ok: false, error: "Logo must be a real PNG or JPEG file, not just a file named .png or .jpg." }, { status: 400 });
  const ext = isPng ? "png" : "jpg";
  clearOld();
  const name = `${base}.${ext}`;
  writeFileSync(path.join(DIR, name), buf);
  const pastor = setLogo(s.email, `church-logos/${name}`);
  return Response.json({ ok: true, ...pastor });
}
