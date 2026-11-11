import { readFileSync } from "node:fs";
import { Pack, lockPack } from "../lib/pack.mjs";

const store = JSON.parse(readFileSync(new URL("../data/engwebp-GEN.json", import.meta.url), "utf-8"));
const sample = JSON.parse(readFileSync(new URL("../data/sample-pack.json", import.meta.url), "utf-8"));

const checks = [];
function check(name, ok, detail = "") {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

const valid = lockPack(sample, store);
check("Valid sample pack locks", valid.ok, valid.ok ? `hash ${valid.pack.lockHash.slice(0, 12)}...` : valid.errors.join(" | "));
check("Locked pack status is locked", valid.ok && valid.pack.status === "locked");

const tampered = structuredClone(sample);
tampered.memoryVerse.text = "In the beginning, God created the heavens and the world.";
const t1 = lockPack(tampered, store);
check("Tampered memory verse cannot lock", !t1.ok, t1.errors[0]?.split("\n")[0] ?? "");

const tampered2 = structuredClone(sample);
tampered2.adultDevotionals[1].scripture.text = "God said, “Let there be light,” and there was darkness.";
const t2 = lockPack(tampered2, store);
check("Tampered devotional verse cannot lock", !t2.ok);

const short = structuredClone(sample);
short.adultDevotionals = short.adultDevotionals.slice(0, 4);
const t3 = lockPack(short, store);
check("4 adult devotionals (not 5) cannot lock", !t3.ok, t3.errors[0] ?? "");

const shortKid = structuredClone(sample);
shortKid.kidDevotionals = shortKid.kidDevotionals.slice(0, 4);
check("4 kid devotionals (not 5) cannot lock", !lockPack(shortKid, store).ok);

const notOriginal = structuredClone(sample);
notOriginal.chorus.original = false;
check("Chorus not labeled original cannot lock", !lockPack(notOriginal, store).ok);

const schema = Pack.safeParse(sample);
check("Sample pack passes Zod schema", schema.success);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
