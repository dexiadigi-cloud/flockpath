import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { COLORING_TEMPLATES, matchColoring } from "../lib/coloring.mjs";
import { formatRef, formatRefsInText, parseRef } from "../lib/refs.mjs";
import { formatMeter } from "../lib/translation.mjs";

// Nov 2, 2026, pastor-test fix: this builder used to hardcode
// data/locked-pack.json and ignore its arguments, so it
// silently built the canonical Genesis pack when handed a
// different pack, and it only wrote pack.typ, never a PDF.
// Now it takes a pack file and an output PDF:
//   node scripts/build-pdf.mjs <pack.json> <output.pdf>
// Defaults, for old callers: the canonical locked pack, and
// output/pack-<id>.pdf. The canonical file is only read, never
// written, so building another pack cannot corrupt it.
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const packArg = process.argv[2];
const packPath = packArg ? path.resolve(process.cwd(), packArg) : path.join(root, "data", "locked-pack.json");
const pack = JSON.parse(readFileSync(packPath, "utf-8"));
const outArg = process.argv[3];
const outPdf = outArg ? path.resolve(process.cwd(), outArg) : path.join(root, "output", `pack-${pack.id}.pdf`);
// Nov 1, 2026, coloring pick: the pastor's review-page pick
// wins over the matcher, when it names a template file that
// actually exists. Before this fix the PDF always used the
// matcher and ignored the stored svgTemplateId, so preview
// and print could disagree. Fallback is still the matcher,
// so an old pack with no pick, or a pick for a template
// that has not landed yet, still prints a real page.
const picked = pack.coloring?.svgTemplateId;
const pickedFile = picked && COLORING_TEMPLATES[picked] ? COLORING_TEMPLATES[picked].file : null;
const coloringId = pickedFile && existsSync(new URL(`../public/coloring/${pickedFile}`, import.meta.url))
  ? picked
  : matchColoring(pack);
const coloringFile = COLORING_TEMPLATES[coloringId].file;

// Nov 11, 2026, v53: Spanish PDF strings. The pack's
// language picks every printed label; a legacy pack has no
// language and prints English, as before. The translation
// name in the credit lines follows the pack's translation:
// BSB for English, Reina-Valera 1909 or Español Sencillo
// 2026 for Spanish. The Spanish strings here are
// unreviewed by a Spanish-speaking reader; see the
// reader-review list in the v53 notes.
const isEs = (pack.language ?? "en") === "es";
const lang = isEs ? "es" : "en";
const DAY_ES = { Monday: "lunes", Tuesday: "martes", Wednesday: "miércoles", Thursday: "jueves", Friday: "viernes" };
const dayName = (d) => (isEs ? (DAY_ES[d] ?? d) : d);
const TRANSLATION_NAME = { bsb: "Berean Standard Bible", rv1909: "Reina-Valera 1909", spabes: "La Biblia en Español Sencillo 2026" };
const translationName = TRANSLATION_NAME[pack.translation ?? "bsb"] ?? "Berean Standard Bible";
// The Español Sencillo 2026 text is public domain; the
// project asks for a courtesy credit to AudioBiblia.org
// and its editor Irma Flores, never a CC BY 4.0 label
// (that license covers the 2018/2019 editions, not 2026).
const SPABES_CREDIT = "Traducción por AudioBiblia.org, editado por Irma Flores.";

// Nov 20, 2026, v61 fix (item 18): the internal build label
// leaks into the pack when the pastor's title or passage
// carries it ("Power of the Cross v60 Family Pack"), and the
// builder used to print the title verbatim on the cover, in
// the subtitle, in every footer, and in the coloring title
// and description. Strip a version marker at render time:
// " v60" (any v<number>) and " mac-test-YYYYMMDD". The
// stored title, passage, and coloring text are untouched,
// so the pack file and the download name keep what the
// pastor typed; only the printed pack drops the label.
const stripVersion = (s) => String(s ?? "")
  .replace(/\s+v\d+\b/gi, "")
  .replace(/^v\d+\s+/gi, "")
  .replace(/\s+mac-test-\d{8}\b/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();
const displayTitle = stripVersion(pack.title);
const displayPassage = stripVersion(pack.passage);

// Escape Typst markup characters in generated prose so a stray
// # or * in a devotional cannot break the compile or change layout.
function esc(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([#\$&%_\*\`\[\]])/g, "\\$1")
    .replace(/@/g, "\\@");
}
function para(s) {
  return esc(s).replace(/\n/g, "\n\n");
}

// Nov 3, 2026, quotation rule: every passage printed unchanged
// from a source (Scripture, classic devotional, hymn lyrics)
// is wrapped in quotation marks, so families can always tell
// quoted writing from generated prose. Generated text (day
// bodies, prayers, kid retellings, activities, leader notes,
// the sources list) is never quoted. The marks are added here
// at render time, so stored pack text stays clean.
function quote(s) {
  return `\u201C${para(s)}\u201D`;
}

// Nov 5, 2026, v28, Jeremiah's verse overflow: a long
// verse (or range) is shortened in the PDF print only,
// and only when it overflows. The pack's stored text and
// the review page keep the full verse; only the print
// shortens it. The shortened text is never a paraphrase.
// Nov 20, 2026, v61 fix (item 16): the 300-character cap
// cut the payoff words (Genesis 2:17 printed "you will
// surely…" and dropped "die"; Leviticus 4:13-21, 1,289
// characters, printed about 1.3 verses). Day pages run
// only 60-70% full, so fit was never the constraint. The
// cap is now 1,500 characters, which prints the longest
// cited range seen (Leviticus 4:13-21) in full, and a
// range still over the cap is cut at the last sentence
// end inside the window, never mid-sentence, so no
// sentence's final word is ever dropped. The ellipsis
// stays, so the reader knows the passage continues.
const VERSE_PRINT_MAX = 1500;
function shortenVerse(text) {
  const t = String(text ?? "");
  if (t.length <= VERSE_PRINT_MAX) return t;
  const window = t.slice(0, VERSE_PRINT_MAX);
  let cutAt = -1;
  for (const mark of [". ", "! ", "? "]) cutAt = Math.max(cutAt, window.lastIndexOf(mark));
  if (/[.!?]$/.test(window)) cutAt = Math.max(cutAt, window.length - 1);
  if (cutAt >= 0) return window.slice(0, cutAt + 1).trimEnd() + "\u2026";
  const lastSpace = window.lastIndexOf(" ");
  const head = (lastSpace > 0 ? window.slice(0, lastSpace) : window).trimEnd().replace(/[,;:]+$/, "");
  return head + "\u2026";
}

const days = pack.adultDevotionals.map((a, i) => {
  const k = pack.kidDevotionals[i] ?? { title: "", retelling: "", activity: "" };
  // Nov 5, 2026, round-3: every pastor-visible ref renders
  // as a full book name. Stored refs stay codes; the
  // Scripture line uses formatRef, and all prose (titles,
  // bodies, prayers, retellings, activities) passes through
  // formatRefsInText, so a code that slipped into model
  // prose, or a kid title that fell back to the verse
  // reference, never prints as JAS 1:4.
  return `
= ${esc(dayName(a.day))}: ${esc(formatRefsInText(a.title, lang))}

*${isEs ? "Escritura" : "Scripture"}: ${esc(formatRef(a.scripture.reference, lang))}*
#rect(inset: 10pt, stroke: 0.5pt)[${quote(shortenVerse(a.scripture.text))}]

${para(formatRefsInText(a.body, lang))}

_${isEs ? "Oración" : "Prayer"}:_ ${para(formatRefsInText(a.prayer, lang))}
${a.lookAhead ? `\n_${isEs ? "Prepárate para el domingo" : "Get ready for Sunday"}:_ ${para(formatRefsInText(a.lookAhead, lang))}\n` : ""}
== ${isEs ? "Para niños (6-10 años)" : "For kids (ages 6-10)"}: ${esc(formatRefsInText(k.title, lang))}

${para(formatRefsInText(k.retelling, lang))}

_${isEs ? "Actividad" : "Activity"}:_ ${para(formatRefsInText(k.activity, lang))}
`;
}).join("\n#pagebreak()\n");

const questions = pack.leaderQuestions.map((q, i) => `${i + 1}. ${esc(formatRefsInText(q.question, lang))}\n\n${q.leaderNote ? `_${isEs ? "Nota para el líder" : "Leader note"}:_ ${para(formatRefsInText(q.leaderNote, lang))}\n` : ""}`).join("\n");

// Nov 11, 2026, v52, Phase 2 member mode: the member
// template. A member pack carries the mandatory label
// "Personal study, not pastor-approved" on the cover and in
// the footer of every page. It has no approval code, no
// church logo, no church name, and no "Approved by" line.
// The label is part of the template, not something the
// member can switch off: the PDF builder renders it from
// the pack mode, and the member save route refuses any pack
// that tries to carry church branding or a lock hash.
const isMember = (pack.mode ?? "pastor") === "member";
const MEMBER_LABEL = isEs ? "Estudio personal, no aprobado por el pastor" : "Personal study, not pastor-approved";
const MEMBER_NOTE = isEs
  ? `Estudio personal, no aprobado por el pastor. Las Escrituras en este paquete son de ${translationName}, llenadas por código, no escritas por el modelo. Las versiones para niños son relatos, no citas de las Escrituras.${pack.translation === "spabes" ? ` ${SPABES_CREDIT}` : ""}`
  : "Personal study, not pastor-approved. Scripture in this pack is the Berean Standard Bible, filled in by code, not written by the model. Kid versions are retellings, not Scripture quotes.";

// Oct 31, 2026, hash placement: families do not need the hash,
// so it is small (7pt) and pushed to the very bottom of the
// last page, above the footer, with #v(1fr) where it is used.
// It is kept because it proves what the pastor approved.
// Nov 11, 2026, v52: a member pack has no hash at all, so it
// gets a note box with the same verification words and the
// mandatory label instead, in the same spot.
const hashBox = isMember ? `#align(center)[#rect(inset: 6pt, stroke: 0.5pt)[
  #text(7pt)[${MEMBER_NOTE}]
]]` : `#align(center)[#rect(inset: 6pt, stroke: 0.5pt)[
  #text(7pt)[${isEs ? "Código de aprobación" : "Approval code"}: #text(7pt, font: "DejaVu Sans Mono")[${pack.lockHash}]]

  #text(7pt)[${isEs ? `Las Escrituras en este paquete son de ${translationName}, verificadas carácter por carácter contra el texto bíblico antes de bloquear. Las versiones para niños son relatos, no citas de las Escrituras.${pack.translation === "spabes" ? ` ${SPABES_CREDIT}` : ""}` : "Scripture in this pack is the Berean Standard Bible,\n  verified character for character against the verse store before locking.\n  Kid versions are retellings, not Scripture quotes."}]
]]`;

const classicFrom = pack.classicDevotional
  ? `${pack.classicDevotional.workTitle || pack.classicDevotional.source}${pack.classicDevotional.tradition_label ? ` (${pack.classicDevotional.tradition_label})` : ""}`
  : "";
// Nov 5, 2026, round-2: a classic excerpt that itself
// opens with a quotation (Chambers quoting 1 John 1:7)
// used to print doubled opening quotes: the wrapper's
// mark plus the excerpt's own. When the excerpt already
// opens with a quote mark, the wrapper adds only its
// closing mark, so the page shows exactly one opening
// quote and no source character is removed.
const classicExcerpt = pack.classicDevotional ? pack.classicDevotional.excerpt : "";
const classicQuote = !pack.classicDevotional ? ""
  : (classicExcerpt.trimStart().startsWith("\u201C") || classicExcerpt.trimStart().startsWith('"'))
    ? `${para(classicExcerpt)}\u201D`
    : quote(classicExcerpt);
const classicLeader = [
  pack.classicDevotional ? `= ${isEs ? "Devocional clásico" : "Classic devotional"}: ${esc(pack.classicDevotional.title)}

_${isEs ? "De" : "From"} ${esc(classicFrom)}, ${isEs ? "anclado a" : "anchored to"} ${esc(formatRef(pack.classicDevotional.anchor_ref, lang))} (${isEs ? "dominio público" : "public domain"}). ${isEs ? "Este es un texto clásico, no un texto generado." : "This is a classic text, not generated text."}_

${classicQuote}
` : "",
  (pack.leaderQuestions ?? []).length ? `= ${isEs ? "Página para el líder del grupo pequeño" : "Small-group leader page"}

_${isEs ? "Escrituras en este paquete" : "Scripture in this pack"}:_ ${pack.adultDevotionals.map((a) => `${esc(dayName(a.day))}: ${esc(formatRef(a.scripture.reference, lang))}`).join("; ")}. ${isEs ? "Versículo para memorizar" : "Memory verse"}: ${esc(formatRef(pack.memoryVerse.reference, lang))}. ${isEs ? `Cada cita es de ${translationName}, llenada por código, no escrita por el modelo.` : "Every quote is from the Berean Standard Bible, filled in by code, not written by the model."}

${questions}
` : "",
].filter(Boolean).join("\n");

// Nov 2, 2026, denomination labels: a compact sources list at
// the end of the leader page, with every voice labeled. It
// lists the commentary voices that shaped the days, and the
// devotional voices only when a classic devotional prints, so
// an unchecked classic devotional never leaves its voice in
// the list. Legacy packs without phosVoices print no list,
// which keeps their layout exactly as before.
// Nov 19, 2026, Viz.Bible Phase 1: the places note rides on
// the leader page, after the leader questions, one line per
// place (name, modern identification, confidence). It prints
// only when the locked pack carries placesNote, so the review
// toggle, which deletes that field, drops the note. The
// sources list gains a places entry the same way, and the
// "every source is public domain" sentence is corrected when
// places are present, because place data is CC BY 4.0, not
// public domain. No map image in this phase.
const placesBlock = classicLeader && (pack.placesNote?.places?.length ?? 0)
  ? `\n\n_${isEs ? "Lugares de fondo" : "Background - places"}:_\n${pack.placesNote.places.map((p) => `- ${esc(p.name)}${p.modern_name ? ` (${isEs ? "hoy" : "today"} ${esc(p.modern_name)})` : ` (${isEs ? "identificación moderna incierta" : "modern identification uncertain"})`} - ${isEs ? "confianza" : "confidence"} ${esc(p.confidence)}.`).join("\n")}`
  : "";
// Nov 19, 2026, Viz.Bible Phase 2: the names note rides on
// the leader page, after the places note, one line per name
// (Hitchcock meaning first, then one TIPNR family link as
// cross-check, then the verse). It prints only when the locked
// pack carries namesNote, so the review toggle, which deletes
// that field, drops the note. The sources list gains a names
// entry the same way, and the "every source is public domain"
// sentence is corrected when names are present, because name
// data is CC BY 4.0, not public domain. No AI description text
// is printed: TIPNR's brief / short / article descriptions
// were never ingested.
const namesBlock = classicLeader && (pack.namesNote?.names?.length ?? 0)
  ? `\n\n_${isEs ? "Nombres de fondo" : "Background - names"}:_\n${pack.namesNote.names.map((n) => `- ${esc(n.name)}${n.meaning ? ` (${isEs ? "significa" : "means"} "${esc(n.meaning)}")` : ""}${n.family_note ? ` - ${esc(n.family_note)}` : ""} (${isEs ? "nombrado en" : "named in"} ${esc(n.verse)}).`).join("\n")}`
  : "";
// Nov 19, 2026, Viz.Bible Phase 3: the topics note rides on
// the leader page, after the names note, one line per verse
// (reference, then its text in the pack's translation).
// Nov 19, 2026, v60 fixes: the text is the pack's own
// translation (rv1909 / spabes for a Spanish pack), filled
// by phos_context.py with --translation, never BSB text in
// a Spanish note. It prints only when the locked pack
// carries topicsNote, so the review toggle, which deletes
// that field, drops the note. The sources list gains a topics
// entry the same way, and the "every source is public domain"
// sentence is corrected when topics are present, because topical
// data is CC BY 4.0, not public domain. No ESV text is printed:
// the verses are rendered in the pack's translation from the bundle.
// Nov 20, 2026, v61 fix (item 5): the stored topics refs are
// English ("Philippians 4:6-7"), while the verse text is the
// pack's own translation, so a Spanish pack printed English
// labels over Spanish verses. The refs are mapped at render
// time through the existing Spanish book names (lib/refs.mjs),
// so the stored refs stay English and English packs print
// exactly what they stored. "Psalms" has no parse entry (the
// map uses "Psalm"), so it is folded to "Psalm" first; an
// unparsable ref falls back to the stored string, never a guess.
const topicRef = (r) => {
  if (!isEs) return r;
  const parsed = parseRef(r) ?? parseRef(String(r ?? "").replace(/^Psalms\b/, "Psalm"));
  return parsed ? formatRef(parsed, "es") : r;
};
const topicsBlock = classicLeader && (pack.topicsNote?.verses?.length ?? 0)
  ? `\n\n_${isEs ? "Temas de fondo" : "Background - topics"}${pack.topicsNote.topic ? ` (${esc(pack.topicsNote.topic)})` : ""}:_\n${pack.topicsNote.verses.map((v) => `- ${esc(topicRef(v.verse))}: ${esc(v.text)}`).join("\n")}`
  : "";
const voiceLabel = (v) => `${v.title}${v.tradition_label ? ` (${v.tradition_label})` : ""}`;
const sourceVoices = [
  ...(pack.phosVoices?.commentary ?? []),
  ...(pack.classicDevotional ? (pack.phosVoices?.devotionals ?? []) : []),
];
// Nov 5, 2026, round-2: the same voice could list
// three times (one per anchored devotional), which
// reads like padding. Labels dedupe here, so each voice
// prints once.
const sourceLabels = [...new Set(sourceVoices.map(voiceLabel))];
if (pack.placesNote?.places?.length) sourceLabels.push("Places: OpenBible.info (CC BY 4.0)");
if (pack.namesNote?.names?.length) sourceLabels.push("Names: STEP Bible (CC BY 4.0)");
if (pack.topicsNote?.verses?.length) sourceLabels.push("Topics: OpenBible.info (CC BY 4.0)");
const hasPlaces = pack.placesNote?.places?.length ? true : false;
const hasNames = pack.namesNote?.names?.length ? true : false;
const hasTopics = pack.topicsNote?.verses?.length ? true : false;
// Nov 19, 2026, Viz.Bible Phase 2: the public-domain sentence is
// corrected for each CC BY 4.0 source actually present (places,
// names, or both); with neither it is unchanged.
// Nov 19, 2026, Viz.Bible Phase 3: topics join the same rule, so
// the sentence now covers all eight combinations. The four
// pre-existing strings (neither, places only, names only, both)
// are reproduced verbatim below.
let ccByNote;
if (hasPlaces && hasNames && hasTopics) {
  ccByNote = isEs ? "Los datos de lugares son de OpenBible.info, CC BY 4.0; los datos de nombres son de STEP Bible, CC BY 4.0; los datos de temas son de OpenBible.info, CC BY 4.0; todas las demás fuentes son de dominio público." : "Place data is OpenBible.info, CC BY 4.0; name data is STEP Bible, CC BY 4.0; topic data is OpenBible.info, CC BY 4.0; every other source is public domain.";
} else if (hasPlaces && hasNames) {
  ccByNote = isEs ? "Los datos de lugares son de OpenBible.info, CC BY 4.0; los datos de nombres son de STEP Bible, CC BY 4.0; todas las demás fuentes son de dominio público." : "Place data is OpenBible.info, CC BY 4.0; name data is STEP Bible, CC BY 4.0; every other source is public domain.";
} else if (hasPlaces && hasTopics) {
  ccByNote = isEs ? "Los datos de lugares son de OpenBible.info, CC BY 4.0; los datos de temas son de OpenBible.info, CC BY 4.0; todas las demás fuentes son de dominio público." : "Place data is OpenBible.info, CC BY 4.0; topic data is OpenBible.info, CC BY 4.0; every other source is public domain.";
} else if (hasNames && hasTopics) {
  ccByNote = isEs ? "Los datos de nombres son de STEP Bible, CC BY 4.0; los datos de temas son de OpenBible.info, CC BY 4.0; todas las demás fuentes son de dominio público." : "Name data is STEP Bible, CC BY 4.0; topic data is OpenBible.info, CC BY 4.0; every other source is public domain.";
} else if (hasPlaces) {
  ccByNote = isEs ? "Los datos de lugares son de OpenBible.info, CC BY 4.0; todas las demás fuentes son de dominio público." : "Place data is OpenBible.info, CC BY 4.0; every other source is public domain.";
} else if (hasNames) {
  ccByNote = isEs ? "Los datos de nombres son de STEP Bible, CC BY 4.0; todas las demás fuentes son de dominio público." : "Name data is STEP Bible, CC BY 4.0; every other source is public domain.";
} else if (hasTopics) {
  ccByNote = isEs ? "Los datos de temas son de OpenBible.info, CC BY 4.0; todas las demás fuentes son de dominio público." : "Topic data is OpenBible.info, CC BY 4.0; every other source is public domain.";
} else {
  ccByNote = isEs ? "Cada fuente es de dominio público. Las etiquetas nombran la tradición del autor para que el pastor pueda juzgar cada voz." : "Every source is public domain. Labels name the author's tradition so the pastor can judge each voice.";
}
const sourcesBlock = classicLeader && sourceLabels.length
  ? `\n\n#text(9pt)[_${isEs ? "Fuentes de este paquete" : "Sources for this pack"}:_ ${esc(sourceLabels.join("; "))}. ${ccByNote}]`
  : "";
const classicLeaderWithSources = classicLeader + placesBlock + namesBlock + topicsBlock + sourcesBlock;

// Nov 19, 2026, v60 fixes: 1,957 of the 2,198 hymns carry
// no tune data, so a hymn with no tune prints no tune line
// at all, instead of a blank "Tune: , .". The composer
// prints only with its tune.
const tuneLine = pack.hymn?.tune
  ? `${isEs ? "Melodía" : "Tune"}: ${esc(pack.hymn.tune)}${pack.hymn.tuneComposer ? `, ${esc(pack.hymn.tuneComposer)}` : ""}. `
  : "";
// Nov 20, 2026, v61 fix (item 17): the hymn's sourceNote is
// internal QA/provenance text ("staged exactly", "first-line
// text slug", "that record was NOT used", "PD rests on",
// "108-111 hymnals") and never prints in a family pack. The
// footer carries one clean credit line: the source host from
// the stored URL, plus the share-page sentence. The stored
// sourceNote stays in the pack file for the review record;
// only the print drops it. A missing or unparsable URL
// prints no source, never a broken line.
// The stanza 3 artifact "For the remission of your sins:""
// is the Hymnary source's closing quote stranded after a
// colon at the end of a line; strip a quote that directly
// follows a colon at end of line, hymn lyrics only.
const hymnSourceHost = (() => {
  try { return new URL(pack.hymn?.sourceUrl ?? "").hostname.replace(/^www\./, ""); } catch { return ""; }
})();
const hymnLyrics = String(pack.hymn?.lyrics ?? "").replace(/:(["\u201C\u201D])(?=\r?\n|$)/g, ":");
const song = pack.hymn ? `= ${isEs ? "Himno" : "Hymn"}: ${esc(pack.hymn.title)}

_${tuneLine}${isEs ? "Letra" : "Words"}: ${esc(pack.hymn.author)} (${esc(pack.hymn.authorYears)}), ${pack.hymn.wordsYear}. ${isEs ? "Metro" : "Meter"}: ${esc(formatMeter(pack.hymn.meter, lang))}._

_${isEs ? "Dominio público." : "Public domain."}_

${quote(hymnLyrics)}

#v(1fr)
#text(9pt)[${hymnSourceHost ? `${isEs ? "Fuente" : "Source"}: ${esc(hymnSourceHost)}. ` : ""}${isEs ? "La partitura y el audio están en la página para compartir." : "Sheet music and audio are on the share page."}]
` : pack.chorus ? `= ${isEs ? "Coro original (solo paquetes antiguos)" : "Original chorus (legacy pack only)"}: ${esc(pack.chorus.title)}

_Original, written for this pack. Not a known worship lyric._

${para(pack.chorus.chordPro)}

#v(1fr)
#text(9pt)[Original chorus, written for this pack. There is no sheet music or audio link for an original chorus; hymn pages link to sheet music and audio on the share page.]
` : "";

const coloring = pack.coloring ? `= ${isEs ? "Colorear" : "Coloring"}: ${esc(stripVersion(pack.coloring.title).replace(/ Coloring$/, "").replace(/^Colorear: /, ""))}

${para(stripVersion(pack.coloring.description))}

#v(1em)
#align(center)[#image("../public/coloring/${coloringFile}", width: 90%)]

#v(1fr)
${hashBox}
` : "";

// Nov 11, 2026, v51, Phase 1: Shared Dinner Conversation.
// One family discussion question, pulled from the leader
// guide, given a name and a prominent spot of its own,
// between the days and the leader page. It is the first
// leader question, verbatim, never a new question written
// for this section. No leader questions means no section,
// exactly like the leader page itself.
const dinner = (pack.leaderQuestions ?? []).length ? `= ${isEs ? "Conversación familiar en la cena" : "Shared Dinner Conversation"}

_${isEs ? "Hablen de esto juntos en la cena esta semana" : "Talk about this together at dinner this week"}:_

${para(formatRefsInText(pack.leaderQuestions[0].question, lang))}
` : "";

// Nov 1, 2026, section toggles: the PDF renders only the
// sections in the locked pack, in order, up to 9 pages for a
// full pack without leader notes, up to 10 pages with places,
// names, or topics notes (Jeremiah accepted 10 pages with notes
// Nov 19, 2026), and up to 11 pages when a long day passage
// pushes a day page over (Jeremiah accepted 11 pages for long
// passages Nov 20, 2026, after the v61 review pack ran 11 pages
// on the full Leviticus 4:13-21 quote, ~1,289 chars under the
// raised 1500-char verse cap). Fewer for a subset. The hash box lives under
// the coloring page when coloring is included, otherwise at
// the end of the last section, so a pack without coloring
// still carries its hash and verification note.
const sections = [];
if (days) sections.push(days);
// Nov 11, 2026, v51: the dinner question rides on the
// leader page, not on a page of its own, because a section
// of its own printed as one question on a nearly blank
// page. It stays first, ahead of the leader heading, so
// it is still the prominent spot. Only if a pack somehow
// has leader questions but no leader page does it print
// alone, so the question is never lost.
if (classicLeaderWithSources) sections.push(dinner + classicLeaderWithSources);
else if (dinner) sections.push(dinner);
if (song) sections.push(song);
if (coloring) sections.push(coloring);
let body = sections.join("\n#pagebreak()\n");
if (!pack.coloring) body += `\n\n#v(1fr)\n${hashBox}`;

// Nov 4, 2026, fresh-install fix (Mac test item 29): a
// clean install has no output/ folder, and the old code
// copied logos and wrote pack.typ without creating it, so
// the FIRST print PDF build on a fresh install failed
// before Typst ever ran. Create the folder first, every
// build, before any copy or write below, so any install
// can print.
mkdirSync(new URL("../output/", import.meta.url), { recursive: true });

// Oct 31, 2026, packet branding: black transparent logo on the
// cover bottom, website in the footer on pages 2+, no footer on
// page 1 so the website does not appear twice. Logo is copied
// into output/ at build time, so pack.typ stays
// self-contained. If the logo file is missing, the build still
// compiles with the tagline alone, never a broken image.
const logoSrc = new URL("../flockpath-logo-black-transparent.png", import.meta.url);
const logoDst = new URL("../output/logo.png", import.meta.url);
const logoExists = existsSync(logoSrc);
if (logoExists) copyFileSync(logoSrc, logoDst);
else console.log("WARNING: logo file missing, cover will show tagline only");

// Nov 3, 2026, church logo on the cover: the pastor's own
// mark, printed above the title when the pack carries one.
// The path is validated to stay under public/church-logos,
// and a missing or unreadable file skips silently, never a
// broken image, exactly like the Flockpath logo above.
// Nov 11, 2026, v52: a member pack never prints a church
// logo, even if one somehow rides in the pack file, because
// a member pack has no church.
let churchLogoFile = null;
if (!isMember && pack.churchLogo && /^church-logos\/[A-Za-z0-9._-]+\.(png|jpg|jpeg)$/i.test(pack.churchLogo)) {
  const churchSrc = path.join(root, "public", pack.churchLogo);
  const churchExt = pack.churchLogo.split(".").pop().toLowerCase();
  if (existsSync(churchSrc)) {
    try {
      churchLogoFile = `church-logo.${churchExt}`;
      copyFileSync(churchSrc, path.join(root, "output", churchLogoFile));
    } catch { churchLogoFile = null; }
  }
}

// Oct 31, 2026, footer split, pages 2+ only: left is their info,
// right is ours. Left: "Pastor, Church | Title". Right:
// "www.flockpath.si | Page N". If pastor/church are empty,
// left falls back to the title alone. Grid with 1fr + auto
// keeps left and right at the margins even when the left
// side wraps for a long church name.
// Nov 11, 2026, v52: a member pack's footer carries the
// mandatory label on EVERY page, including page 1 (the
// cover), because the label is the member pack's identity.
// Left: "Personal study, not pastor-approved | Title".
const pastorChurch = [pack.pastorName, pack.church].filter(Boolean).map(esc).join(", ");
const footerLeft = isMember ? `${MEMBER_LABEL} | ${esc(displayTitle)}` : (pastorChurch ? `${pastorChurch} | ${esc(displayTitle)}` : esc(displayTitle));
const footerExpr = isMember
  ? `context { grid(columns: (1fr, auto), align(left)[#text(9pt)[${footerLeft}]], align(right)[#text(9pt)[#link("https://www.flockpath.si")[www.flockpath.si] | ${isEs ? "Página" : "Page"} #counter(page).display()]]) }`
  : `context if counter(page).get().first() == 1 { [] } else { grid(columns: (1fr, auto), align(left)[#text(9pt)[${footerLeft}]], align(right)[#text(9pt)[#link("https://www.flockpath.si")[www.flockpath.si] | ${isEs ? "Página" : "Page"} #counter(page).display()]]) }`;
// Nov 5, 2026, round-3 cover note (v24): one short block on
// the cover, one source only. The pastor's own note wins
// when it has a verified verse and words; else the sermon
// summary and quote print when the draft has one; else the
// block is omitted and the cover is unchanged. Lengths are
// capped at review and at generation, so the block fits the
// flexible space above the Flockpath logo.
const coverNote = (() => {
  if (pack.pastorNote?.verse?.text && (pack.pastorNote.note ?? "").trim()) {
    return {
      // Nov 11, 2026, v52: a member's own note is "My note",
      // never "Pastor's note", because no pastor wrote it.
      label: isMember ? (isEs ? "Mi nota" : "My note") : (isEs ? "Nota del pastor" : "Pastor's note"),
      lines: [
        `*${esc(formatRef(pack.pastorNote.verse.reference, lang))}*`,
        quote(shortenVerse(pack.pastorNote.verse.text)),
        para(formatRefsInText(pack.pastorNote.note, lang)),
      ].join("\n\n  "),
    };
  }
  if ((pack.sermonSnapshot?.summary ?? "").trim()) {
    const parts = [para(formatRefsInText(pack.sermonSnapshot.summary, lang))];
    if (pack.sermonSnapshot.quote) parts.push(quote(formatRefsInText(pack.sermonSnapshot.quote, lang)));
    return { label: isEs ? "Del sermón" : "From the sermon", lines: parts.join("\n\n  ") };
  }
  return null;
})();
const typ = `#set page(paper: "us-letter", margin: 0.75in, footer: ${footerExpr})
#set text(size: 12pt)
#set heading(numbering: none)

#align(center)[
${churchLogoFile ? `  #image("${churchLogoFile}", width: 24%)\n\n  #v(0.5em)\n` : ""}  #text(26pt, weight: "bold")[${esc(displayTitle)}]

  #text(14pt)[${esc(displayPassage)}]

  #text(12pt)[${isEs ? "Una semana de discipulado familiar" : "A week of family discipleship"}]
]

#v(0.6em)
#align(center)[#rect(inset: 14pt, stroke: 1pt)[
  *${isEs ? "Versículo para memorizar" : "Memory verse"}: ${esc(formatRef(pack.memoryVerse.reference, lang))}*

  ${quote(shortenVerse(pack.memoryVerse.text))}
]]

#v(0.6em)
${isMember ? `#align(center)[#rect(inset: 10pt, stroke: 1pt)[
  *${MEMBER_LABEL}*
]]` : `#align(center)[
  ${isEs ? "Aprobado por" : "Approved by"} ${esc(pack.pastorName)}, ${esc(pack.church)}
]`}
${coverNote ? `
#v(0.6em)
#align(center)[#rect(inset: 12pt, stroke: 0.5pt)[
  *${coverNote.label}*

  ${coverNote.lines}
]]` : ""}

#v(1fr)
#align(center)[
${logoExists ? `  #image("logo.png", width: 22%)\n\n  #v(0.5em)\n` : ""}  #text(10pt)[${isEs ? "Hecho con amor y por la gracia de Dios" : "Made with love and by the grace of God"} - #link("https://www.flockpath.si")[www.flockpath.si]]
]

#pagebreak()
${body}
`;

writeFileSync(new URL("../output/pack.typ", import.meta.url), typ);
writeFileSync(new URL("../output/pack.typ.txt", import.meta.url), typ);
console.log("Wrote output/pack.typ");
// Compile to PDF in the same command, so a caller gets a PDF,
// not just a .typ file to compile by hand. Typst binaries are
// platform-specific, and the old code picked the Linux binary
// whenever it existed, which cannot run on a Mac. Pick by
// platform (Apple Silicon, Intel Mac, Linux), then fall back
// to a typst on PATH. A fonts dir, when present, is passed
// as an extra font path, so the one explicit font in the
// template (DejaVu Sans Mono, lock hash) renders the same
// on every machine instead of falling back per system.
const typstDirs = {
  "darwin-arm64": "typst-aarch64-apple-darwin",
  "darwin-x64": "typst-x86_64-apple-darwin",
  "linux-x64": "typst-x86_64-unknown-linux-musl",
};
const typstDir = typstDirs[`${process.platform}-${process.arch}`];
const bundledTypst = typstDir ? path.join(root, "tools", typstDir, "typst") : null;
const typstBin = (bundledTypst && existsSync(bundledTypst)) ? bundledTypst : "typst";
const typstArgs = ["compile", "--root", root];
const fontsDir = path.join(root, "tools", "fonts");
if (existsSync(fontsDir)) typstArgs.push("--font-path", fontsDir);
typstArgs.push(path.join(root, "output", "pack.typ"), outPdf);
execFileSync(typstBin, typstArgs, { stdio: "inherit" });
console.log(`Wrote ${outPdf}`);
