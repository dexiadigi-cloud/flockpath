import { readFileSync, writeFileSync } from "node:fs";
import { expandDraft } from "../lib/generate.mjs";

// Nov 1, 2026, review-before-lock: turn a section-generated
// draft (references only, no verse text, no status) into a
// reviewable draft (quotes filled from the verse store and
// verified by lockPack later, status draft, hymn and candidates
// carried through). This script does NOT lock. Locking is the
// pastor's act, on the review page, after they have checked it.
const [draftPath, storePath, outPath] = process.argv.slice(2);
if (!draftPath || !storePath || !outPath) {
  console.error("usage: node scripts/expand-draft.mjs <draft.json> <store.json> <out.json>");
  process.exit(2);
}
const draft = JSON.parse(readFileSync(draftPath, "utf-8"));
const store = JSON.parse(readFileSync(storePath, "utf-8"));
// Nov 11, 2026, v53: the translation comes from the draft,
// not a hardcoded "bsb". A legacy draft carries no
// translation and fills from BSB, as before.
const expanded = expandDraft(draft, store, draft.translation ?? "bsb");
expanded.status = "draft";
writeFileSync(outPath, JSON.stringify(expanded, null, 1));
console.log(`Expanded draft written to ${outPath}, id ${expanded.id}`);
