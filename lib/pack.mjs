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
  // Nov 11, 2026, v54, Phase 4 flexible length: a pack is
  // 3, 5, or 7 days, so Saturday and Sunday join the enum
  // for a 7-day pack. A 5-day pack is still Mon-Fri.
  day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  title: z.string().min(1),
  scripture: VerseQuote,
  body: z.string().min(1),
  prayer: z.string().min(1),
  // Nov 11, 2026, v51, Phase 1: a short "get ready for
  // Sunday" note, on the last day before Sunday (Wednesday
  // for a 3-day pack, Friday for 5 days, Saturday for 7).
  // Optional so legacy packs without it still lock, and so
  // a last day without one still prints cleanly. A 7-day
  // pack ends on Sunday, so it carries no lookAhead.
  lookAhead: z.string().optional(),
});

export const KidDevotional = z.object({
  day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
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
  // Nov 19, 2026, v60 fixes: 1,957 of the 2,198 hymns in
  // Hymn Desk carry no tune data (tune null), and 1,961
  // carry no tune composer either, so a matched hymn with
  // no tune used to fail the lock outright. Tune and
  // composer are nullable now; the PDF omits the tune
  // line when there is none, instead of printing a blank.
  tune: z.string().nullable().optional(),
  tuneComposer: z.string().nullable().optional(),
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

// Nov 19, 2026, v60 fixes, Viz.Bible Phases 1-3: the
// leader-page background notes. They are metadata built
// by phos_context.py and copied verbatim by
// generate_sections.py, never model-written and never
// prompt input. modern_name, meaning, and family_note
// are nullable because the bundle leaves them null when
// the source has no value for them. All three notes are
// optional on the Pack so a pack built before them, or
// a pack whose pastor toggled them off in review, still
// locks exactly as before.
export const PlacesNote = z.object({
  places: z.array(z.object({
    name: z.string().min(1),
    modern_name: z.string().nullable().optional(),
    confidence: z.string().min(1),
    verse: z.string().min(1),
  })),
  source: z.string().min(1),
});

export const NamesNote = z.object({
  names: z.array(z.object({
    name: z.string().min(1),
    kind: z.string().min(1),
    meaning: z.string().nullable().optional(),
    family_note: z.string().nullable().optional(),
    verse: z.string().min(1),
  })),
  source: z.string().min(1),
});

export const TopicsNote = z.object({
  topic: z.string().min(1),
  verses: z.array(z.object({
    verse: z.string().min(1),
    text: z.string().min(1),
  })),
  source: z.string().min(1),
});

export const Pack = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  passage: z.string().min(1), // e.g. "Genesis 1"
  pastorName: z.string().min(1),
  // Nov 11, 2026, v52, Phase 2 member mode: a member pack
  // carries no church, so church is optional at the field
  // level and the mode refine below enforces the rule:
  // pastor packs need a church, member packs must not have
  // one. Legacy packs (no mode) are pastor packs.
  church: z.string().optional(),
  // Nov 11, 2026, v52, Phase 2 member mode: "pastor" or
  // "member". Absent means pastor, so every pack locked
  // before member mode keeps its old meaning. A member pack
  // is signed with the member's first name only (memberName),
  // never a church name, and is labeled "Personal study, not
  // pastor-approved" on the cover and every page footer.
  mode: z.enum(["pastor", "member"]).optional(),
  memberName: z.string().optional(),
  // Nov 11, 2026, v53, Phase 3 Spanish v1: the pack's
  // language ("en" or "es") and translation ("bsb",
  // "rv1909", "spabes"). Both optional, so every pack
  // locked before Spanish keeps its old meaning:
  // English + BSB. A Spanish pack must carry both, and
  // the refine below enforces that the pair is one of
  // the three real combinations (en/bsb, es/rv1909,
  // es/spabes). RVR1960 is copyrighted and is never a
  // valid translation here.
  language: z.enum(["en", "es"]).optional(),
  translation: z.enum(["bsb", "rv1909", "spabes"]).optional(),
  // Nov 11, 2026, v54, Phase 4 flexible length: the length
  // the pastor picked at build time, 3, 5, or 7 days.
  // Optional so every pack locked before flexible length
  // keeps its old meaning (5 days). It is a record of the
  // build choice, not a lock-time rule: a pastor may still
  // uncheck days in review and lock a shorter pack, so no
  // refine ties it to the array lengths below.
  dayCount: z.union([z.literal(3), z.literal(5), z.literal(7)]).optional(),
  status: z.enum(["draft", "locked"]),
  memoryVerse: VerseQuote,
  // Nov 1, 2026, section toggles: a pastor may lock a subset
  // of days, for example Wednesday only, so the pack is 1 to
  // 7 days, not always exactly the built length. Adult and kid lengths must
  // match, because a day is adult plus kid together, and at
  // least one day must stay, otherwise there is no pack.
  adultDevotionals: z.array(AdultDevotional).min(1).max(7),
  kidDevotionals: z.array(KidDevotional).min(1).max(7),
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
  // Nov 19, 2026, v60 fixes: the three background notes
  // ride the locked pack so the PDF leader page can print
  // them. Optional, so legacy packs without them still
  // lock, and a pastor who toggles a note off in review
  // (the review page deletes the field) locks a pack
  // without it, exactly as before.
  placesNote: PlacesNote.optional(),
  namesNote: NamesNote.optional(),
  topicsNote: TopicsNote.optional(),
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
}).refine((p) => {
  // Nov 11, 2026, v52, Phase 2 member mode: a member pack
  // needs a member first name and no church and no church
  // logo; a pastor pack needs a church. Legacy packs (no
  // mode) take the pastor branch, so their rule is unchanged.
  if ((p.mode ?? "pastor") === "member") {
    return !p.church && Boolean(p.memberName?.trim()) && !p.churchLogo;
  }
  return Boolean(p.church?.trim());
}, {
  message: "A member pack needs a member first name and no church or church logo; a pastor pack needs a church.",
}).refine((p) => {
  // Nov 11, 2026, v53: language and translation must agree.
  // Legacy packs carry neither and pass. A pack carrying one
  // must carry the other, and the pair must be a real one.
  const lang = p.language ?? "en";
  const tr = p.translation ?? "bsb";
  if (p.language === undefined && p.translation === undefined) return true;
  if (p.language === undefined || p.translation === undefined) return false;
  return (lang === "en" && tr === "bsb") || (lang === "es" && (tr === "rv1909" || tr === "spabes"));
}, {
  message: "Language and translation must agree: en with bsb, es with rv1909 or spabes.",
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
  // Nov 11, 2026, v52, Phase 2 member mode: a member pack
  // can never lock. The lock (SHA-256 approval code) is the
  // pastor's trust mark; a locked member pack would carry
  // pastor authority it does not have. Member packs save
  // through the personal route instead, which verifies
  // Scripture but mints no hash. This is the server-side
  // backstop: even a direct call to this function refuses.
  if ((parsed.data.mode ?? "pastor") === "member") {
    return { ok: false, errors: ["Member packs cannot be locked. They are personal study, not pastor-approved."] };
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
  // Nov 11, 2026, v52 member mode: a member pack's filename
  // carries the member's first name, never a church, because
  // a member pack has no church.
  const identity = pack?.mode === "member" ? slug(pack?.memberName || pack?.pastorName, "Personal") : slug(pack?.church, "Church");
  return `${slug(pack?.title, "Pack")}_${identity}_${suffix}`;
}

export function pdfFileName(pack, id) {
  return `${packSlug(pack, id)}.pdf`;
}

export function resolvePackId(id) {
  const s = String(id ?? "").trim();
  const i = s.lastIndexOf("_pack-");
  return i >= 0 ? s.slice(i + "_pack-".length) : s;
}

// Nov 11, 2026, v52, Phase 2 member mode: the send-to-pastor
// approval bridge. A member exports a draft file; the pastor
// opens it in pastor mode as a member-submitted review draft.
// The bridge carries references only, never Scripture text:
// the pastor's app re-retrieves every verse from its own BSB
// store on import, so no AI-written Scripture can cross the
// bridge. The format marker lets the import route refuse
// anything that is not a Flockpath member draft. Generated
// prose (bodies, prayers, retellings) does cross, because
// the pastor reviews it with the same gates; the sermon text
// and snapshot cross too, because the lock re-verifies the
// sermon quote against them. Hymn and coloring cross as
// chosen, because both are vetted picks, not generated text.
export const BRIDGE_FORMAT = "flockpath-member-draft";
export const BRIDGE_VERSION = 1;

export function exportBridgeDraft(pack, submittedBy) {
  const refOnly = (q) => (q ? { reference: q.reference } : q);
  const p = JSON.parse(JSON.stringify(pack ?? {}));
  const draft = {
    ...p,
    memoryVerse: refOnly(p.memoryVerse),
    adultDevotionals: (p.adultDevotionals ?? []).map((d) => ({ ...d, scripture: refOnly(d.scripture) })),
  };
  if (draft.pastorNote?.verse) draft.pastorNote = { ...draft.pastorNote, verse: refOnly(draft.pastorNote.verse) };
  // Nothing that identifies a church or a lock may cross:
  // the pastor's side supplies both at lock time, if the
  // pastor locks it at all. The hymn and its candidates do
  // cross: they are vetted public-domain picks from Hymn
  // Desk, not generated text, and the pastor needs the list
  // to pick a different song in review.
  delete draft.lockHash;
  delete draft.churchLogo;
  delete draft.church;
  delete draft.pastorName;
  return {
    format: BRIDGE_FORMAT,
    version: BRIDGE_VERSION,
    submittedBy: String(submittedBy ?? "").trim(),
    submittedAt: new Date().toISOString(),
    draft,
  };
}
