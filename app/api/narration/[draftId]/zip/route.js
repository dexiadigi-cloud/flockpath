import { cookies } from "next/headers";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { verifySession } from "../../../../../lib/auth.mjs";
import { narrationDir, resolveNarrationSource } from "../../../../../lib/narration.mjs";

// Nov 20, 2026, v62, item 14: "Download the whole week" - one
// zip of every narration WAV for a draft or a locked pack.
// No zip dependency is installed, so this builds a stored
// (uncompressed) zip by hand: local headers, central
// directory, end record, CRC-32 per file. Same ownership
// check as the single-file route: the signed-in pastor must
// own the draft or the library pack. Dotfiles (the .pack.json
// the narrate route stages for the engine) never ship.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files) {
  // files: [{ name, data: Buffer }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf-8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

export async function GET(request, { params }) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const { draftId } = await params;
  if (!/^job-[0-9a-f]{16}$/.test(String(draftId ?? ""))) return Response.json({ ok: false, error: "Unknown draft or pack." }, { status: 400 });
  if (!resolveNarrationSource(draftId, s.email)) return Response.json({ ok: false, error: "This narration belongs to another account." }, { status: 403 });
  const dir = narrationDir(draftId);
  let names = [];
  try {
    names = readdirSync(dir)
      .filter((n) => /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-(adult|kid)\.wav$/.test(n))
      .sort();
  } catch { /* no directory yet */ }
  if (!names.length) return Response.json({ ok: false, error: "This pack has no narration to download yet." }, { status: 404 });
  const files = names.map((name) => ({ name, data: readFileSync(path.join(dir, name)) }));
  const zip = buildZip(files);
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="flockpath-narration-${draftId}.zip"`,
    },
  });
}
