import { readFileSync, writeFileSync } from "node:fs";
import { lockPack } from "../lib/pack.mjs";
import { expandDraft } from "../lib/generate.mjs";
import { checkQuality } from "../lib/quality.mjs";

// Step 7.5 Phase D, step 3 helper: lock a generated draft.
// Usage: node scripts/lock-draft.mjs <draft.json> <store.json> <out-locked.json>
// The draft may carry a hymn and a classicDevotional; expandDraft
// carries both through, and lockPack verifies every verse quote
// against the store and the translation label, exactly as before.
const [draftPath, storePath, outPath] = process.argv.slice(2);
const draft = JSON.parse(readFileSync(draftPath, "utf-8"));
const store = JSON.parse(readFileSync(storePath, "utf-8"));
const expanded = expandDraft(draft, store, "bsb");
const q = checkQuality(expanded);
console.log("QUALITY", JSON.stringify(q));
if (!q.ok) {
  console.log("Quality failed, not locking. Fix the draft, do not lock anyway.");
  process.exit(2);
}
const r = lockPack(expanded, store, "bsb");
console.log("LOCK", r.ok, r.errors);
if (!r.ok) process.exit(1);
const locked = { ...r.pack, lockedAt: new Date().toISOString() };
writeFileSync(outPath, JSON.stringify(locked, null, 1));
console.log("Wrote", outPath, "hash", locked.lockHash);
