import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

// Nov 1, 2026, QR fix: the old version hardcoded a localhost URL
// for the Genesis pack only, so a printed cover scanned on a phone
// in church opened nothing (localhost is the phone itself).
// This version takes the pack id, builds a public share URL from
// the site base, and uses high error correction plus a quiet zone
// so the code still scans when printed, posted on a wall, or
// photographed at an angle. Usage:
//   node scripts/make-qr.mjs <pack-id> [base-url]
// Base default is the Flockpath site. The URL only works once
// that site is live with a public share page; until then the
// code is correct in form but the destination is not yet live,
// and no live link is claimed.
const packId = process.argv[2] || "generated-genesis-1";
const base = (process.argv[3] || process.env.FLOCKPATH_SITE_URL || "https://www.flockpath.si").replace(/\/$/, "");
const SHARE_URL = `${base}/pack/${packId}`;

await QRCode.toFile("output/qr.png", SHARE_URL, { width: 800, margin: 2, errorCorrectionLevel: "H" });
const svg = await QRCode.toString(SHARE_URL, { type: "svg", margin: 2, errorCorrectionLevel: "H" });
writeFileSync("output/qr.svg", svg);
console.log("Wrote output/qr.png and output/qr.svg for", SHARE_URL);
