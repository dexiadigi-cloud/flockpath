import { readFileSync, writeFileSync } from "node:fs";
import { generateAndLock } from "../lib/generate.mjs";

// Note: the v2 file is a draft (references only, no Scripture
// text), so this uses generateAndLock, which expands quotes from
// the store first, then runs the same lockPack() as Step 5.
const store = JSON.parse(readFileSync(new URL("../data/engwebp-GEN.json", import.meta.url), "utf-8"));
const draft = JSON.parse(readFileSync(new URL("../data/generated-pack-draft-v2.json", import.meta.url), "utf-8"));
const result = await generateAndLock({ draft, verseStore: store, translation: "engwebp" });
if (!result.ok) {
  console.error("Cannot lock:", result.errors.join(" | "));
  process.exit(1);
}
const locked = { ...result.pack, lockedAt: new Date().toISOString() };
writeFileSync(new URL("../data/locked-pack.json", import.meta.url), JSON.stringify(locked, null, 1));
console.log(`Locked ${locked.id}, hash ${locked.lockHash}`);
console.log(`Refs: ${locked.adultDevotionals.map((d) => d.scripture.reference).join(", ")}`);
