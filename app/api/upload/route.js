import { cookies } from "next/headers";
import { execFile } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { verifySession } from "../../../lib/auth.mjs";

// Nov 1, 2026, PDF upload: a pastor's sermon is often a
// PDF. This route accepts one PDF, extracts its text with
// the local pypdf script, and returns the text. It does NOT
// generate a pack, extract refs, or store the file. The
// pastor still presses Extract refs and confirms the plan,
// exactly as with pasted text, so a PDF cannot silently
// become a pack. The temp file is deleted after extraction,
// even on failure. Limit: 10 MB, PDF only, unencrypted text
// PDFs only. Scanned-image PDFs have no text to extract,
// and the error says so plainly.
const run = promisify(execFile);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  if (!/\.pdf$/i.test(file.name)) {
    return Response.json({ ok: false, error: "Only PDF files are accepted here. For text files, use the .txt or .md upload." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    return Response.json({ ok: false, error: "That PDF is over 10 MB. Use a smaller copy, or paste the sermon text instead." }, { status: 400 });
  }
  const tmpPath = path.join(tmpdir(), `flockpath-upload-${Date.now()}.pdf`);
  try {
    writeFileSync(tmpPath, bytes);
    // System python3, with pypdf made available via PYTHONPATH
    // to the project's venv site-packages. The venv python
    // binary itself is a symlink Turbopack cannot resolve at
    // build time, so it is never referenced directly here.
    const script = path.join(process.cwd(), "scripts", "extract_pdf.py");
    const sitePackages = path.join(process.cwd(), ".venv", "lib", "python3.12", "site-packages");
    const { stdout } = await run(
      "python3",
      [script, tmpPath],
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONPATH: sitePackages } }
    );
    const data = JSON.parse(stdout);
    return Response.json({ ok: true, pages: data.pages, text: data.text, chars: data.text.length });
  } catch (e) {
    const raw = (e.stderr || e.message || "").trim().split("\n").pop() || "Could not read this PDF.";
    // Nov 3, 2026, agent-test improvement I2: a fake PDF used
    // to surface a raw pypdf message ("Stream has ended
    // unexpectedly"). A parse failure means the file is not a
    // readable PDF, so say that in plain language; other
    // errors keep their own message.
    const message = /stream|eof|pdfread|invalid pdf|empty|startxref|trailer/i.test(raw)
      ? "That file is not a readable PDF. Use a real PDF, or paste the sermon text instead."
      : raw;
    return Response.json({ ok: false, error: message }, { status: 400 });
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}
