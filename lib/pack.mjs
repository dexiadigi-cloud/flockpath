import { z } from "zod";
import { createHash } from "node:crypto";
import { resolveRefText } from "./refs.mjs";

// Flockpath pack schema, Step 3.
//
// Design rules, enforced here, not in the UI:
//  - Exactly 5 adult devotionals (Mon-Fri) and exactly 5 kid versions.
//  - Every direct Scripture quote is a VerseQuote object with a
//    reference, a translation code, and text. Body text is never
//    treated as Scripture, and kid versions carry a retelling, not
//    a paraphrase presented as a quote.
//  - Nov 2, 2026: original choruses are removed. New packs
//    carry a verified public-domain hymn, or no song at all.
//    The chorus field stays optional only for legacy packs
//    locked before that change, which still render and lock.
//  - A pack can only lock when every VerseQuote matches the verse
//    store character for character. lockPack() refuses otherwise;
//    there is no "lock anyway" path.

export const VerseQuote = z.object({
  reference: z.string().min(1), // e.g. "GEN 1:1"
  translation: z.string().min(1), // e.g. "bsb" (Berean Standard Bible)
  text: z.string().min(1),
});

export const AdultDevotional = z.object({
  day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]),
  title: z.string().min(1),
  scripture: VerseQuote,
  body: z.string().min(1),
  prayer: z.string().min(1),
});

export const KidDevotional = z.object({
  day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]),
  title: z.string().min(1),
  // A retelling in plain words for ages 6-10. Deliberately NOT a
  // VerseQuote: a retelling must never be displayed as Scripture.
  retelling: z.string().min(1),
  activity: z.string().min(1),
});

export const LeaderQuestion = z.object({
  question: z.string().min(1),
  leaderNote: z.string().optional(),
});

export const Chorus = z.object({
  title: z.string().min(1),
  original: z.literal(true),
  // ChordPro text: lyrics with chords in [brackets], e.g.
  // "[G]God made the [C]world so good"
  chordPro: z.string().min(1),
});

export const Coloring = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  // ID of a vetted SVG outline template in the template library,
  // not a generated image and not a free-form upload in the MVP.
  svgTemplateId: z.string().min(1),
});

// Step 7.5 Phase C: a public-domain hymn, from Hymn Desk.
// All four rights parts that apply must be Public Domain in
// the US, with the setting named explicitly. A hymn with a
// copyrighted modern harmonization ships with the traditional
// melody only, never with that harmonization.
export const Hymn = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tune: z.string().min(1),
  tuneComposer: z.string().min(1),
  author: z.string().min(1),
  authorYears: z.string().min(1),
  wordsYear: z.number(),
  meter: z.string().min(1),
  lyrics: z.string().min(1),
  rights: z.object({
    music: z.string().min(1),
    setting: z.string().min(1),
    words: z.string().min(1),
    translation: z.string().min(1),
  }),
  sourceUrl: z.string().min(1),
  sourceNote: z.string().min(1),
});

// Nov 5, 2026, round-3 cover note (v24): a short block on
// the PDF cover, one source only. sermonSnapshot is
// model-written from the pasted sermon (a short summary plus
// one verbatim quote, or no quote when none verified);
// pastorNote is the pastor's own words plus a verse whose
// text is store-filled, never typed. sermonText is the full
// pasted sermon, kept so a quote can be re-verified against
// it at lock time. All three are optional so legacy packs
// without them still lock.
export const SermonSnapshot = z.object({
  summary: z.string().min(1),
  quote: z.string().nullable(),
});

export const PastorNote = z.object({
  verse: VerseQuote,
  note: z.string().min(1),
});

export const ClassicDevotional = z.object({
  source: z.string().min(1), // e.g. "my_utmost", "spurgeon"
  title: z.string().min(1),
  anchor_ref: z.string().min(1),
  excerpt: z.string().min(1),
  // Nov 2, 2026, denomination labels, carried from the Phos
  // bundle. Optional so legacy packs without them still lock.
  workTitle: z.string().optional(),
  tradition: z.string().optional(),
  tradition_label: z.string().optional(),
  sensitivity: z.string().optional(),
});

// Nov 2, 2026, denomination labels: the Phos voices that shaped
// a draft (commentary sources across the days, devotional
// rotation), carried as metadata so review can show them labeled
// and the PDF leader page can list them. Never generated text.
export const PhosVoice = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  tradition: z.string().optional(),
  tradition_label: z.string().optional(),
  sensitivity: z.string().optional(),
});

export const Pack = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  passage: z.string().min(1), // e.g. "Genesis 1"
  pastorName: z.string().min(1),
  church: z.string().min(1),
  status: z.enum(["draft", "locked"]),
  memoryVerse: VerseQuote,
  // Nov 1, 2026, section toggles: a pastor may lock a subset
  // of days, for example Wednesday only, so the pack is 1 to
  // 5 days, not always exactly 5. Adult and kid lengths must
  // match, because a day is adult plus kid together, and at
  // least one day must stay, otherwise there is no pack.
  adultDevotionals: z.array(AdultDevotional).min(1).max(5),
  kidDevotionals: z.array(KidDevotional).min(1).max(5),
  // 0 questions means the leader page was unchecked, not a
  // short page. A present list is still capped at 10.
  leaderQuestions: z.array(LeaderQuestion).max(10),
  // Song and coloring are optional in the same way: unchecked
  // means omitted from the final pack, not broken.
  chorus: Chorus.optional(),
  coloring: Coloring.optional(),
  // Nov 3, 2026, church logo: relative path under
  // public/church-logos, optional so legacy packs without it
  // still lock. Printed on the cover when present.
  churchLogo: z.string().optional(),
  // Nov 2, 2026, denomination labels: bundle voices metadata,
  // optional so legacy packs without it still lock.
  phosVoices: z.object({
    commentary: z.array(PhosVoice),
    devotionals: z.array(PhosVoice),
  }).optional(),
  // Step 7.5 Phase B, optional: a classic public-domain devotional
  // that anchors to a verse in the passage, from Phos. Labeled
  // with its source, never presented as generated text.
  classicDevotional: ClassicDevotional.optional(),
  // Step 7.5 Phase C, optional: the song, a verified
  // public-domain hymn. No hymn means no song page.
  hymn: Hymn.optional(),
  // Nov 1, 2026, pastor swap: the top hymn matches, stored
  // in the draft so the review page can offer them as a
  // choice. The locked pack keeps only the chosen hymn, or
  // none if the pastor picks no song. Nov 5, 2026, round-5:
  // max 5, because the no-match fallback offers the 5
  // closest related hymns instead of nothing.
  hymnCandidates: z.array(Hymn).max(5).optional(),
  // Nov 5, 2026, round-3 cover note (v24): the sermon
  // snapshot, the pastor's own note, and the full sermon
  // text the quote verifies against. Optional so legacy
  // packs without them still lock.
  sermonSnapshot: SermonSnapshot.optional(),
  pastorNote: PastorNote.optional(),
  sermonText: z.string().optional(),
}).refine((p) => p.adultDevotionals.length === p.kidDevotionals.length, {
  message: "Adult and kid devotionals must have the same number of days, because a day is adult plus kid together.",
});

export function collectQuotes(pack) {
  const quotes = [pack.memoryVerse];
  for (const d of pack.adultDevotionals) quotes.push(d.scripture);
  // Nov 5, 2026, round-3 cover note: the pastor-note verse
  // is a real Scripture quote, so it verifies exactly like
  // the day verses, against the same store.
  if (pack.pastorNote?.verse) quotes.push(pack.pastorNote.verse);
  return quotes;
}

export function verifyPack(pack, verseStore, expectedTranslation = null) {
  // verseStore: { "GEN 1:1": "In the beginning, ..." }
  // Step 7.5 Phase A: when expectedTranslation is given, the
  // translation label is checked too. Before this, WEB text
  // labeled as something else still locked, because only the
  // text was checked. Pass "bsb" for the current store.
  const errors = [];
  for (const q of collectQuotes(pack)) {
    if (expectedTranslation && q.translation !== expectedTranslation) {
      errors.push(`Translation label mismatch for ${q.reference}: labeled "${q.translation}", expected "${expectedTranslation}".`);
    }
    // v28, Nov 5, 2026: a range reference resolves to the
    // joined text of its verses, so a range quote verifies
    // against the single-verse store the same way a single
    // verse does. A range with a verse missing from the
    // store is unknown, never silently partial.
    const stored = resolveRefText(q.reference, verseStore);
    if (stored === undefined) {
      errors.push(`Unknown reference, cannot verify: ${q.reference}`);
    } else if (stored !== q.text) {
      errors.push(
        `Verse mismatch, publish blocked: ${q.reference}\n  quoted: ${q.text}\n  stored: ${stored}`
      );
    }
  }
  // Nov 5, 2026, round-3 cover note: the sermon quote is not
  // Scripture, but it is presented as the preacher's own
  // words, so it must appear verbatim in the pasted sermon
  // text, or the pack cannot lock. The check is
  // case-insensitive and ignores extra whitespace, because
  // the model may adjust capitalization; the printed quote
  // is the sermon's own span, fixed at generation time.
  const snap = pack.sermonSnapshot;
  if (snap?.quote) {
    const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    // v26, Nov 5, 2026: a quote pasted with quotation
    // marks must not block the lock. The marks are not
    // in the sermon text, and the PDF adds them at print
    // time, so they are stripped before comparing (the
    // review page strips them on input too; this is the
    // server-side backstop for a quote already stored).
    const stripQuotes = (s) => String(s ?? "").trim().replace(/^["\u201c\u201d]+/, "").replace(/["\u201c\u201d]+$/, "").trim();
    const sermon = pack.sermonText ?? "";
    if (!sermon.trim()) {
      errors.push("Sermon quote cannot be verified: this pack has no sermon text.");
    } else if (!norm(sermon).includes(norm(stripQuotes(snap.quote)))) {
      errors.push("Sermon quote does not match the sermon text. Fix it, or clear it, then try again.");
    }
  }
  return { ok: errors.length === 0, errors };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Nov 3, 2026, agent-test fix B2 follow-up: a locked pack's
// hash must survive a JSON round-trip, or re-verification
// is impossible. An expanded draft can carry optional fields
// set to undefined (chorus, for a hymn pack); Zod keeps such
// a key, stableStringify renders it as the literal word
// "undefined", and the hash covers it, but JSON storage
// drops the key entirely, so the same pack re-verified from
// disk hashed differently. Stripping undefined values from
// the hash input makes the hash identical in memory and on
// disk. Packs with no undefined fields hash exactly as
// before; only the round-trip-unstable ones change.
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

export function lockPack(pack, verseStore, expectedTranslation = null) {
  const parsed = Pack.safeParse(pack);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const verified = verifyPack(parsed.data, verseStore, expectedTranslation);
  if (!verified.ok) return { ok: false, errors: verified.errors };
  // Nov 1, 2026, pastor swap: candidates are a draft-time
  // choice list, not part of the locked pack. The locked pack
  // keeps only the chosen hymn, or none if the pastor picked
  // the original chorus, so the hash covers exactly what prints.
  const { hymnCandidates, ...lockedData } = parsed.data;
  const locked = { ...lockedData, status: "locked" };
  const hash = createHash("sha256").update(stableStringify(stripUndefined(locked))).digest("hex");
  return { ok: true, pack: { ...locked, lockHash: hash }, errors: [] };
}

// Nov 5, 2026, round-5: leader questions are generated one
// per day, in day order (proven by the Nov 5 Powers of God's
// Word pack: Q1 Monday ... Q5 Friday), and review never
// reorders them, so question i belongs to dayNames[i]. A
// question with no day to map to (more questions than days)
// is kept, never dropped on a guess, because dropping
// content the pastor did not uncheck would be worse than
// keeping an extra question.
export function leaderQuestionsForDays(questions, dayNames, onDays) {
  return (questions ?? []).filter((q, i) => i >= dayNames.length || onDays.has(dayNames[i]));
}

// Nov 5, 2026, v27, Jeremiah's PDF naming: a downloaded
// PDF should carry the title the pastor chose and his
// church, so a member knows what the file is, and keep
// the pack job number so it stays unique. The file on
// disk keeps its internal name (pack-<id>.pdf); only the
// download name changes, so PDFs already built keep
// working and nothing needs rebuilding. Parenthetical
// markers such as "(test)" are dropped from the title,
// so a test pack does not carry the marker into the
// filename. "Dealing With Your Enemies (test)" +
// "Sample Church" + "job-beb69dfdd9eb3c55" becomes
// "DealingWithYourEnemies_SampleChurch_pack-job-beb69dfdd9eb3c55.pdf".
// v28, Nov 5, 2026: the share link uses the same name
// (packSlug, without the extension), so the link tells a
// member what it is and matches the PDF. resolvePackId
// reads the real id back out of a slug, so a slug URL
// and a plain id URL both open the same pack.
export function packSlug(pack, id) {
  const slug = (s, fallback) => {
    const clean = String(s ?? "").replace(/\([^)]*\)/g, " ").replace(/[^A-Za-z0-9]+/g, " ").trim();
    const words = clean.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
    return words.join("") || fallback;
  };
  const suffix = String(id ?? "").startsWith("job-") ? `pack-job-${id.slice(4)}` : `pack-${id}`;
  return `${slug(pack?.title, "Pack")}_${slug(pack?.church, "Church")}_${suffix}`;
}

export function pdfFileName(pack, id) {
  return `${packSlug(pack, id)}.pdf`;
}

export function resolvePackId(id) {
  const s = String(id ?? "").trim();
  const i = s.lastIndexOf("_pack-");
  return i >= 0 ? s.slice(i + "_pack-".length) : s;
}
