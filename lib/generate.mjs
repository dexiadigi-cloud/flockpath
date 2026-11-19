import { Pack, lockPack } from "./pack.mjs";
import { matchColoring } from "./coloring.mjs";
import { resolveRefText } from "./refs.mjs";

// Flockpath generation, Step 4.
//
// The single most important design decision in this file:
// the model NEVER writes Scripture text.
//
// The prompt gives the model a list of allowed references from the
// passage, and the model returns devotionals that cite references
// only. expandDraft() then fills every quote from the verse store,
// character for character. If the model cites a reference that is
// not in the store, expansion fails and the pack cannot lock.
// A model can hallucinate a reference, it cannot hallucinate
// Scripture text into a locked pack, because its text never
// reaches the pack.
//
// Kid retellings are generated prose, labeled retelling, never
// presented as quotes. The chorus is generated original text,
// labeled original, never a known lyric.

export function buildPrompt(passage, allowedReferences, dayPlan = null) {
  const planLines = dayPlan
    ? [
        "Day plan, assigned by the system. Follow it exactly, one distinct verse and angle per day, no repeats:",
        ...dayPlan.map((d) => `- ${d.day}: reference ${d.reference}, angle: ${d.angle}`),
        "Do NOT choose your own verses. Do NOT reuse a verse on another day.",
      ]
    : [];
  return [
    "You are writing a family discipleship pack for a church.",
    "Output JSON ONLY, no markdown, no explanation.",
    "The pack must have exactly 5 adult devotionals (Monday-Friday) and exactly 5 kid versions (ages 6-10).",
    "For Scripture, output ONLY the reference, like {\"reference\": \"GEN 1:1\"}.",
    "NEVER write out Scripture text yourself. NEVER invent a verse.",
    `Use ONLY these references for Scripture citations: ${allowedReferences.join(", ")}.`,
    ...planLines,
    "Kid versions must be retellings in plain words for ages 6-10, not quotes.",
    "The chorus must be original, short, and singable, with chords in ChordPro format.",
    "Leader questions: 5 questions for a small group, with short leader notes.",
    `Passage: ${passage}`,
    "JSON shape: {title, passage, pastorName, church, memoryVerse: {reference}, adultDevotionals: [{day, title, scripture: {reference}, body, prayer}], kidDevotionals: [{day, title, retelling, activity}], leaderQuestions: [{question, leaderNote}], chorus: {title, original: true, chordPro}, coloring: {title, description, svgTemplateId}}",
  ].join("\n");
}

export function expandDraft(draft, verseStore, translation) {
  // v28, Nov 5, 2026: a range reference is not a single
  // store key, so a direct lookup returns undefined and
  // the expand throws "Reference not in verse store".
  // resolveRefText returns the joined range text (or the
  // single verse text), and undefined only when a covered
  // verse is really missing.
  const fill = (ref) => {
    const text = resolveRefText(ref, verseStore);
    if (text === undefined) throw new Error(`Reference not in verse store: ${ref}`);
    return { reference: ref, translation, text };
  };
  const pack = {
    id: draft.id ?? "generated-pack",
    title: draft.title,
    passage: draft.passage,
    pastorName: draft.pastorName,
    church: draft.church,
    status: "draft",
    // Nov 11, 2026, v52, Phase 2 member mode: the mode rides
    // with the pack from generation, so review, lock, and the
    // PDF all see it. A member pack's pastorName is the
    // member's first name (set at review from the session)
    // and its church is empty; the schema refine enforces it.
    ...(draft.mode ? { mode: draft.mode } : {}),
    ...(draft.memberName ? { memberName: draft.memberName } : {}),
    // Nov 11, 2026, v53, Phase 3 Spanish v1: language and
    // translation ride with the pack, so the lock, the PDF,
    // and the bridge know which store filled its verses.
    // The translation here is the store that filled the
    // quotes (the param), not just the draft's label, so
    // the two can never disagree. A legacy draft carries
    // neither, so the language is derived from the store
    // that filled it (rv1909/spabes -> es, anything else
    // -> en): stamping the translation alone would leave
    // a pack with one field and no other, which the
    // schema's agreement check refuses.
    ...{ language: draft.language ?? ((translation === "rv1909" || translation === "spabes") ? "es" : "en") },
    ...(translation ? { translation } : {}),
    // Nov 11, 2026, v54, Phase 4 flexible length: the built
    // length rides with the pack, so review, the lock, and
    // the PDF all know whether it is a 3-, 5-, or 7-day pack.
    ...(draft.dayCount ? { dayCount: draft.dayCount } : {}),
    // Nov 11, 2026, v54, Phase 4 doctrinal profile: the
    // review-only warnings from the doctrinal check ride
    // through, like the hymn candidates. They are advisory
    // notes for the pastor, never printed in a pack: the
    // lock schema does not know the field, so lockPack
    // strips it from the locked pack.
    ...(draft.doctrinalWarnings ? { doctrinalWarnings: draft.doctrinalWarnings } : {}),
    memoryVerse: fill(draft.memoryVerse.reference),
    adultDevotionals: draft.adultDevotionals.map((d) => ({
      ...d,
      scripture: fill(d.scripture.reference),
    })),
    kidDevotionals: draft.kidDevotionals,
    leaderQuestions: draft.leaderQuestions,
    chorus: draft.chorus,
    // Nov 9, 2026, coloring fix (v48): the matcher assigns the
    // coloring id, not the model. The model used to be told to
    // use "creation-sky-sea" for every pack, so a cross pack got
    // a creation picture. matchColoring picks by the pack's own
    // topic and verses, so a cross pack gets a cross page.
    coloring: { ...(draft.coloring ?? {}), svgTemplateId: matchColoring(draft) },
    // Step 7.5 Phase B: carry the Phos classic devotional through,
    // if the draft has one. expandDraft rebuilds the pack, so an
    // explicit field is required or it is silently dropped.
    ...(draft.classicDevotional ? { classicDevotional: draft.classicDevotional } : {}),
    // Nov 2, 2026, denomination labels: same rule for the
    // bundle voices metadata, or review and the PDF lose it.
    ...(draft.phosVoices ? { phosVoices: draft.phosVoices } : {}),
    // Nov 3, 2026, church logo: same rule, or the cover loses
    // the church's own mark.
    ...(draft.churchLogo ? { churchLogo: draft.churchLogo } : {}),
    // Step 7.5 Phase C: same rule for the hymn.
    ...(draft.hymn ? { hymn: draft.hymn } : {}),
    // Nov 1, 2026, pastor swap: carry the candidates through,
    // so the review page can offer them before locking.
    ...(draft.hymnCandidates ? { hymnCandidates: draft.hymnCandidates } : {}),
    // Nov 5, 2026, round-3 cover note (v24): same rule, or
    // the review page never sees the sermon snapshot and
    // the lock can never re-verify its quote.
    ...(draft.sermonSnapshot ? { sermonSnapshot: draft.sermonSnapshot } : {}),
    // Nov 11, 2026, v52: the note verse is filled from the
    // store like every other Scripture quote. The note is
    // added in review, after generation, so without this
    // fill a draft carrying a note verse could never lock,
    // and the bridge import could never re-retrieve it.
    ...(draft.pastorNote ? { pastorNote: { ...draft.pastorNote, ...(draft.pastorNote.verse?.reference ? { verse: fill(draft.pastorNote.verse.reference) } : {}) } } : {}),
    ...(draft.sermonText ? { sermonText: draft.sermonText } : {}),
  };
  return pack;
}

export async function generateAndLock({ draft, verseStore, translation }) {
  let pack;
  try {
    pack = expandDraft(draft, verseStore, translation);
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
  // Step 7.5 Phase A: pass the translation through, so the label
  // is checked as well as the text.
  return lockPack(pack, verseStore, translation);
}

export async function generateViaEndpoint({ baseUrl, model, prompt, apiKey }) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Model endpoint ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return JSON.parse(text);
}
