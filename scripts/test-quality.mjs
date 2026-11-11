import { readFileSync } from "node:fs";
import { checkQuality, assignDays } from "../lib/quality.mjs";

const generated = JSON.parse(readFileSync(new URL("../data/generated-pack-draft.json", import.meta.url), "utf-8"));
const sample = JSON.parse(readFileSync(new URL("../data/sample-pack.json", import.meta.url), "utf-8"));

const g = checkQuality(generated);
console.log("Generated draft (Step 4, before quality gate):");
console.log(g.ok ? "  PASS - no reuse found" : g.issues.map((i) => `  ISSUE: ${i}`).join("\n"));

const s = checkQuality(sample);
console.log("\nSample pack (hand-built, distinct verses):");
console.log(s.ok ? "  PASS - no reuse found" : s.issues.map((i) => `  ISSUE: ${i}`).join("\n"));

// The day plan that would have prevented the Step 4 reuse:
const plan = assignDays(
  ["GEN 1:1", "GEN 1:3", "GEN 1:27", "GEN 1:31", "GEN 2:3"],
  ["God as Maker, before anything else", "Light, God's word does what it says", "Made in God's image", "Creation is very good", "Blessed rest"]
);
console.log("\nDay plan for Genesis 1:");
for (const d of plan) console.log(`  ${d.day}: ${d.reference} - ${d.angle}`);
console.log(`\nPlan references distinct: ${new Set(plan.map((d) => d.reference)).size === 5}`);

// Expectation for this test: generated draft FAILS (it reused GEN 1:1),
// sample PASSES. That proves the gate detects the exact Step 4 failure.
const ok = !g.ok && s.ok;
console.log(ok ? "\nQuality gate detects the Step 4 reuse: OK" : "\nQuality gate test FAILED");
process.exit(ok ? 0 : 1);
