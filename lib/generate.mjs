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
    ...(draft.pastorNote ? { pastorNote: draft.pastorNote } : {}),
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
