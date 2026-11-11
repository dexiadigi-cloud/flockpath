import { readFileSync } from "node:fs";
import { generateAndLock, expandDraft } from "../lib/generate.mjs";
import { lockPack } from "../lib/pack.mjs";

const store = JSON.parse(readFileSync(new URL("../data/engwebp-GEN.json", import.meta.url), "utf-8"));
const draft = JSON.parse(readFileSync(new URL("../data/generated-pack-draft.json", import.meta.url), "utf-8"));

const checks = [];
function check(name, ok, detail = "") {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

const result = await generateAndLock({ draft, verseStore: store, translation: "engwebp" });
check("Local-model draft expands and locks", result.ok, result.ok ? `hash ${result.pack.lockHash.slice(0, 12)}...` : result.errors.join(" | "));
if (result.ok) {
  check("Locked pack memory verse is store text, not model text",
    result.pack.memoryVerse.text === store[result.pack.memoryVerse.reference]);
  check("All adult quotes match store text",
    result.pack.adultDevotionals.every((d) => d.scripture.text === store[d.scripture.reference]));
}

// Negative controls, independent of model quality:
const fake = structuredClone(draft);
fake.memoryVerse = { reference: "GEN 99:99" };
const fakeResult = await generateAndLock({ draft: fake, verseStore: store, translation: "engwebp" });
check("Fake reference draft cannot lock", !fakeResult.ok, fakeResult.errors[0] ?? "");

const expanded = expandDraft(draft, store, "engwebp");
expanded.memoryVerse.text = "In the beginning, God created the heavens and the world.";
check("Tampered expanded quote cannot lock", !lockPack(expanded, store).ok);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
