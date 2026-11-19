"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JourneyStrip from "./JourneyStrip";
import { leaderQuestionsForDays, lockPack, packSlug, verifyPack, exportBridgeDraft } from "../lib/pack.mjs";
import { checkQuality } from "../lib/quality.mjs";
import { COLORING_TEMPLATES, matchColoring } from "../lib/coloring.mjs";
import { formatRef, formatRefsInText, parseRef } from "../lib/refs.mjs";
import verseStore from "../data/bsb-GEN.json";

// Nov 4, 2026, pastor-facing checks (Mac pastor-role test
// items 6, 19, 22, 23, 24): the old gates section printed
// raw gate strings, full quoted verse dumps, and every word
// count, which no pastor wants to read. The gates themselves
// are unchanged; only what the pastor sees changed. Blocking
// problems are reworded in plain language and flagged on the
// section itself, below. Pure length checks (word counts,
// overlap numbers) no longer show on the page at all: they go
// to the review log (see the /api/review-log post below),
// where they belong, behind the scenes.
function fullRef(code, lang = "en") {
  try { return formatRef(code, lang); } catch { return code; }
}

// Nov 11, 2026, v53: Spanish day names for the review
// page's day cards and flags, keyed by the English day enum
// the pack stores. The PDF renders these too.
const DAY_ES = { Monday: "lunes", Tuesday: "martes", Wednesday: "miércoles", Thursday: "jueves", Friday: "viernes", Saturday: "sábado", Sunday: "domingo" };

// Nov 5, 2026, round-3: a pastor reads full book names in
// review, never codes. Stored refs stay codes (the verse
// store, verification, and the Read directive all key on
// them), so convert the pastor-visible text when a draft
// enters state: the code-appended "(Read JAS 1:4.)" in
// leader notes, a kid title that fell back to the verse
// reference, and any code that slipped into model prose.
// The PDF already converts at render time; this is the
// same rule for the review screen. Applied once at load,
// so Reset restores this same form.
function displayNames(p) {
  // Nov 11, 2026, v53: Spanish packs convert codes to
  // Spanish book names (Santiago 1:4, not James 1:4).
  const lang = p.language ?? "en";
  (p.adultDevotionals ?? []).forEach((a) => {
    a.title = formatRefsInText(a.title ?? "", lang);
    a.body = formatRefsInText(a.body ?? "", lang);
    a.prayer = formatRefsInText(a.prayer ?? "", lang);
  });
  (p.kidDevotionals ?? []).forEach((k) => {
    k.title = formatRefsInText(k.title ?? "", lang);
    k.retelling = formatRefsInText(k.retelling ?? "", lang);
    k.activity = formatRefsInText(k.activity ?? "", lang);
  });
  (p.leaderQuestions ?? []).forEach((q) => {
    q.question = formatRefsInText(q.question ?? "", lang);
    q.leaderNote = formatRefsInText(q.leaderNote ?? "", lang);
  });
  return p;
}

function plainScriptureError(e, lang = "en") {
  const m = String(e).match(/for (\S+ \d+:\d+)/);
  const ref = m ? fullRef(m[1], lang) : "";
  // Nov 11, 2026, v53: the plain gate errors render in
  // Spanish for a Spanish pack. These translations are
  // unreviewed; see the reader-review list in the v53 notes.
  if (lang === "es") {
    if (/Translation label mismatch/.test(e)) return `${ref} tiene la etiqueta de traducción incorrecta.`;
    if (/Unknown reference/.test(e)) return `${ref} no se puede verificar.`;
    if (/Verse mismatch/.test(e)) return `${ref} no coincide con el texto bíblico.`;
    if (/Sermon quote does not match/.test(e)) return "La cita del sermón no coincide con el sermón que pegaste. Corríjela, o bórrala, y vuelve a intentarlo.";
    if (/Sermon quote cannot be verified/.test(e)) return "La cita del sermón no se puede comprobar, porque este paquete no tiene texto del sermón. Borra la cita y vuelve a intentarlo.";
    return String(e).split("quoted:")[0].trim();
  }
  if (/Translation label mismatch/.test(e)) return `${ref} is labeled with the wrong translation.`;
  if (/Unknown reference/.test(e)) return `${ref} cannot be verified.`;
  if (/Verse mismatch/.test(e)) return `${ref} does not match the verse store.`;
  // Nov 5, 2026, round-3 cover note: the sermon quote is
  // not Scripture, so its lock error needs its own plain
  // words, not the verse mapping above.
  if (/Sermon quote does not match/.test(e)) return "The sermon quote does not match the sermon you pasted. Fix it, or clear it, then try again.";
  if (/Sermon quote cannot be verified/.test(e)) return "The sermon quote cannot be checked, because this pack has no sermon text. Clear the quote, then try again.";
  return String(e).split("quoted:")[0].trim();
}

function plainIssue(issue) {
  let s = String(issue);
  s = s.replace(/Adult (\w+) and (\w+) bodies overlap too much \(similarity [0-9.]+\)\. Rewrite one with a different angle\./, "$1's and $2's adult sections cover the same ground too closely. Rewrite one with a different angle.");
  s = s.replace(/Kid (\w+) and (\w+) retellings overlap too much \(similarity [0-9.]+\)\./, "$1's and $2's kid retellings cover the same ground too closely.");
  s = s.replace(/\(similarity [0-9.]+\)/g, "");
  // Nov 11, 2026, v53: the Spanish overlap issues carry
  // "(similitud 0.95)"; the number stays in the log only,
  // never on the page, in either language.
  s = s.replace(/\(similitud [0-9.]+\)/g, "");
  s = s.replace(/\bAdult (\w+)\b/g, "$1's adult section");
  s = s.replace(/\bKid (\w+)\b/g, "$1's kid section");
  return s;
}

function plainWarning(w) {
  let s = String(w);
  // Nov 5, 2026, round-2 retelling warning, widened v25
  // to the whole retelling: a retelling that quotes the
  // verse anywhere in it is flagged in pastor speak,
  // before the generic day-name rewrite below would
  // flatten it into a bare restatement.
  s = s.replace(/Kid (\w+): retelling quotes the verse itself\./, "$1's kid section quotes the verse. A retelling should say it in fresh words for kids.");
  s = s.replace(/Leader Q(\d+):/g, "Leader question $1:");
  s = s.replace(/\bAdult (\w+):/g, "$1's adult section:");
  s = s.replace(/\bKid (\w+):/g, "$1's kid section:");
  return s;
}

// Length checks are numbers, not judgement: a pastor does
// not need to know a note is 33 words instead of 40. Those
// stay in the log only, never on this page.
// Nov 11, 2026, v53: Spanish length warnings say
// "palabras, fuera de" and "solapamiento del relato", so
// the filter matches both languages.
function isLengthCheck(w) {
  return /words, outside/.test(w) || /verse overlap/.test(w) || /palabras, fuera de/.test(w) || /solapamiento del relato/.test(w);
}

function mentionsDay(text, day) {
  // Nov 11, 2026, v53: Spanish warnings name the day in
  // Spanish (lunes), so the day-card flag matches either
  // form.
  const es = DAY_ES[day] ?? "";
  return new RegExp(`\\b(${day}${es ? `|${es}` : ""})\\b`, "i").test(String(text));
}

// Step 5: pastor review page.
//
// What the pastor sees, in order:
//  1. Two gates, in plain words, computed live as they edit:
//     Scripture exactness (verifyPack) and originality (checkQuality).
//  2. The pack itself, editable, EXCEPT Scripture text.
//     Scripture text is never typed. Changing a reference refills
//     the text from the verse store, so a typo cannot become a
//     misquote. The memory verse text is read-only for the same reason.
//  3. Approve and Lock, enabled only when both gates pass.
//     Locking snapshots the pack and shows its hash. After locking,
//     fields become read-only. Unlocking creates a new draft, it
//     does not silently edit a locked pack.
//
// Auth, generation, PDF, and share link are later steps. This page
// proves the review-and-lock loop with the real Step 4 pack.

const ALLOWED_REFS = ["GEN 1:1", "GEN 1:3", "GEN 1:27", "GEN 1:31", "GEN 2:3"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function fillVerse(ref, storeMap, translation = "bsb") {
  return { reference: ref, translation, text: storeMap[ref] ?? "" };
}

// Nov 11, 2026, v53: review-page chrome strings. English
// is the current wording, unchanged; Spanish is the v1
// translation of the same chrome (page title, headings,
// buttons, section labels, lock/save area, checks
// headings). The Spanish strings here are unreviewed by a
// Spanish-speaking reader; see the reader-review list in
// the v53 notes. Longer explanatory paragraphs inside the
// page stay English in v1.
const STR_EN = {
  titleMember: "Flockpath: my personal study",
  titlePastor: "Flockpath: pastor review",
  introMember: "Check your study before you save it. The system already checked every Scripture quote and looked for repeats. When both checks pass, save it as your personal study. A personal study is never locked and never carries a church name.",
  introPastor: "Pastor double-checks. The system already checked every Scripture quote and looked for repeats. When both checks pass, Approve and Lock locks the pack.",
  draftNoteMember: "Nothing is saved until you tap Save as my personal study.",
  draftNotePastor: "Nothing is final until you tap Approve and Lock.",
  checksHeading: "Checks before you lock",
  checksIntro: "These update as you edit. Anything that must be fixed is also marked on that section itself, below.",
  checksCleared: (n) => `Checks cleared: ${n} of 2.`,
  scriptureLabel: "Scripture quotes:",
  scriptureOk: "Check out, word for word.",
  scriptureNeed: "Need fixing:",
  daysLabel: "Days are distinct:",
  daysOk: "Yes, each day covers its own ground.",
  daysNeed: "Need fixing:",
  secondLook: "Worth a second look:",
  secondLookNote: "These do not block locking, but do not lock a flagged pack without reading each one. Edit the flagged field, uncheck that section, or tap “This is fine” if you have read it and it is right.",
  doctrinalHeading: "Doctrinal profile notes:",
  doctrinalIntro: "Your doctrinal profile steered this pack. These notes flag where a day leans against it. They do not block locking. Read each one, edit the day if it is wrong, or tap “This is fine” if you have read it and it is right.",
  narrationHeading: "Listen to this pack",
  narrationIntro: "Narration reads each devotional and each kid retelling aloud, in the voice you picked in My packs. It is free, it runs on this computer, and it takes a few minutes for a whole week. The audio is not in the PDF: download it below and share it with the family.",
  narrationButton: "Narrate this pack",
  narrationRunning: "Narrating... this takes a few minutes for a whole week. Keep this page open.",
  narrationUnavailable: "Spanish narration is not available yet: the voice model has no Spanish pronunciation guide, so Spanish words would come out wrong. English packs narrate today.",
  narrationDownload: "Download",
  narrationAdult: "adult",
  narrationKid: "kid",
  checkedByYou: "Checked by you:",
  lengthNotes: (n) => `Plus ${n} length note${n === 1 ? "" : "s"} kept in the background notes, not shown here. Length alone never stops a pack from locking.`,
  packIncludes: (n, total) => `Your pack will include: ${n} day${n === 1 ? "" : "s"} out of ${total}. The days you leave checked are the days in your pack.`,
  sectionsHeading: "Sections in the final pack",
  sectionsIntro: "Uncheck a section and it will not go in the final pack. A day is adult plus kid together. The memory verse is always included. At least one day must stay.",
  voicesHeading: "Voices in this pack",
  packTitle: "Pack title",
  passage: "Passage",
  pastorName: "Pastor name",
  memberName: "Your first name",
  church: "Church",
  memoryVerseHeading: "Memory verse (read-only text, from the verse store)",
  memoryVerseRef: "Memory verse reference (text refills from the store)",
  coverHeading: "On the cover",
  leaderHeading: "Small-group questions",
  hymnPickHeading: "Song for the week: pick a hymn",
  hymnHeading: "Hymn",
  chorusHeading: "Original chorus (legacy pack only)",
  coloringHeading: "Coloring",
  coloringTitle: "Coloring title",
  coloringDesc: "Coloring description",
  readyLock: "Ready to lock?",
  readySave: "Ready to save?",
  lockButton: "Approve and Lock",
  saveButton: "Save as my personal study",
  resetButton: "Start over from the generated draft",
  lockedLine: (name, church) => `Locked. Approved by ${name}, ${church}.`,
  approvalCode: "Approval code:",
  savedPersonalLine: "Saved as your personal study. Personal study, not pastor-approved. It is never locked and never carries a church name.",
  adultTitle: "Adult title",
  adultRef: "Adult Scripture reference (text refills from the store)",
  adultBody: "For adults",
  adultPrayer: "Adult prayer",
  lookAhead: "Get ready for Sunday",
  kidTitle: "Kid title (ages 6-10)",
  kidRetelling: "Kid retelling (plain words, not a quote)",
  kidActivity: "Kid activity",
  questionLabel: (i) => `Question ${i + 1}`,
  leaderNoteLabel: "Leader note",
  dayExcluded: "excluded from final pack",
  needsLook: "Needs a look:",
  rewriteButton: "Rewrite this section",
  rewriting: "Rewriting...",
  thisIsFine: "This is fine",
  leaderToggle: "Small-group leader questions",
  songToggle: "Song (hymn)",
  coloringToggle: "Coloring page",
  coverNoteToggle: "Cover note",
  memoryAlways: (ref) => `Memory verse: ${ref} (always included)`,
  viewStudies: "View my personal studies",
  sendToPastor: "Send to my pastor",
  editAgain: "Edit again",
  downloadPdf: "Download print PDF (Letter)",
  viewShare: "View the public share page for this pack",
  viewLibrary: "View my packs library",
  unlockButton: "Unlock to edit (creates a new draft)",
  savedToLibrary: "Saved to your packs library.",
};

const STR_ES = {
  titleMember: "Flockpath: mi estudio personal",
  titlePastor: "Flockpath: revisión del pastor",
  introMember: "Revisa tu estudio antes de guardarlo. El sistema ya comprobó cada cita de las Escrituras y buscó repeticiones. Cuando ambas comprobaciones pasan, guárdalo como tu estudio personal. Un estudio personal nunca se bloquea y nunca lleva el nombre de una iglesia.",
  introPastor: "Revisión del pastor. El sistema ya comprobó cada cita de las Escrituras y buscó repeticiones. Cuando ambas comprobaciones pasan, Aprobar y bloquear bloquea el paquete.",
  draftNoteMember: "Nada se guarda hasta que toques Guardar como mi estudio personal.",
  draftNotePastor: "Nada es final hasta que toques Aprobar y bloquear.",
  checksHeading: "Comprobaciones antes de bloquear",
  checksIntro: "Se actualizan mientras editas. Todo lo que hay que corregir también está marcado en esa sección, más abajo.",
  checksCleared: (n) => `Comprobaciones superadas: ${n} de 2.`,
  scriptureLabel: "Citas de las Escrituras:",
  scriptureOk: "Correctas, palabra por palabra.",
  scriptureNeed: "Hay que corregir:",
  daysLabel: "Los días son distintos:",
  daysOk: "Sí, cada día cubre su propio tema.",
  daysNeed: "Hay que corregir:",
  secondLook: "Vale la pena revisar:",
  secondLookNote: "Esto no impide bloquear, pero no bloquees un paquete marcado sin leer cada punto. Edita el campo marcado, desmarca esa sección, o toca «Está bien» si ya lo leíste y está correcto.",
  doctrinalHeading: "Notas de tu perfil doctrinal:",
  doctrinalIntro: "Tu perfil doctrinal orientó este paquete. Estas notas señalan dónde un día va en contra de él. No impiden el bloqueo. Lee cada una, edita el día si está mal, o toca «Está bien» si la leíste y está bien.",
  // Spanish strings below are unreviewed (v53 pattern): a
  // Spanish-speaking reader still needs to check them.
  narrationHeading: "Escucha este paquete",
  narrationIntro: "La narración lee en voz alta cada devocional y cada relato para niños, con la voz que elegiste en Mis paquetes. Es gratis, se hace en esta computadora y toma unos minutos para toda la semana. El audio no está en el PDF: descárgalo abajo y compártelo con la familia.",
  narrationButton: "Narrar este paquete",
  narrationRunning: "Narrando... esto toma unos minutos para toda la semana. Mantén esta página abierta.",
  narrationUnavailable: "La narración en español aún no está disponible: el modelo de voz no tiene guía de pronunciación en español, por lo que las palabras en español saldrían mal. Los paquetes en inglés se narran hoy.",
  narrationDownload: "Descargar",
  narrationAdult: "adulto",
  narrationKid: "niño",
  checkedByYou: "Revisado por ti:",
  lengthNotes: (n) => `Además, ${n} nota${n === 1 ? "" : "s"} de longitud guardada${n === 1 ? "" : "s"} en las notas de fondo, no se muestran aquí. La longitud por sí sola nunca impide bloquear un paquete.`,
  packIncludes: (n, total) => `Tu paquete incluirá: ${n} día${n === 1 ? "" : "s"} de ${total}. Los días que dejes marcados son los días de tu paquete.`,
  sectionsHeading: "Secciones del paquete final",
  sectionsIntro: "Desmarca una sección y no entrará en el paquete final. Un día es adultos más niños juntos. El versículo para memorizar siempre está incluido. Al menos un día debe quedar.",
  voicesHeading: "Voces en este paquete",
  packTitle: "Título del paquete",
  passage: "Pasaje",
  pastorName: "Nombre del pastor",
  memberName: "Tu nombre",
  church: "Iglesia",
  memoryVerseHeading: "Versículo para memorizar (texto de solo lectura, del texto bíblico)",
  memoryVerseRef: "Referencia del versículo para memorizar (el texto se rellena desde el texto bíblico)",
  coverHeading: "En la portada",
  leaderHeading: "Preguntas para el grupo pequeño",
  hymnPickHeading: "Canción de la semana: elige un himno",
  hymnHeading: "Himno",
  chorusHeading: "Coro original (solo paquetes antiguos)",
  coloringHeading: "Colorear",
  coloringTitle: "Título para colorear",
  coloringDesc: "Descripción para colorear",
  readyLock: "¿Listo para bloquear?",
  readySave: "¿Listo para guardar?",
  lockButton: "Aprobar y bloquear",
  saveButton: "Guardar como mi estudio personal",
  resetButton: "Empezar de nuevo desde el borrador generado",
  lockedLine: (name, church) => `Bloqueado. Aprobado por ${name}, ${church}.`,
  approvalCode: "Código de aprobación:",
  savedPersonalLine: "Guardado como tu estudio personal. Estudio personal, no aprobado por el pastor. Nunca se bloquea y nunca lleva el nombre de una iglesia.",
  adultTitle: "Título para adultos",
  adultRef: "Referencia bíblica para adultos (el texto se rellena desde el texto bíblico)",
  adultBody: "Para adultos",
  adultPrayer: "Oración para adultos",
  lookAhead: "Prepárate para el domingo",
  kidTitle: "Título para niños (6-10 años)",
  kidRetelling: "Relato para niños (con palabras sencillas, no una cita)",
  kidActivity: "Actividad para niños",
  questionLabel: (i) => `Pregunta ${i + 1}`,
  leaderNoteLabel: "Nota para el líder",
  dayExcluded: "excluido del paquete final",
  needsLook: "Necesita una revisión:",
  rewriteButton: "Reescribir esta sección",
  rewriting: "Reescribiendo...",
  thisIsFine: "Está bien",
  leaderToggle: "Preguntas para el grupo pequeño",
  songToggle: "Canción (himno)",
  coloringToggle: "Página para colorear",
  coverNoteToggle: "Nota de portada",
  memoryAlways: (ref) => `Versículo para memorizar: ${ref} (siempre incluido)`,
  viewStudies: "Ver mis estudios personales",
  sendToPastor: "Enviar a mi pastor",
  editAgain: "Editar de nuevo",
  downloadPdf: "Descargar PDF para imprimir (Carta)",
  viewShare: "Ver la página pública de este paquete",
  viewLibrary: "Ver mi biblioteca de paquetes",
  unlockButton: "Desbloquear para editar (crea un nuevo borrador)",
  savedToLibrary: "Guardado en tu biblioteca de paquetes.",
};

function Field({ label, value, onChange, multiline, readOnly, maxLength }) {
  const style = { width: "100%", padding: 8, fontSize: 15, border: "1px solid #ccc", borderRadius: 6, background: readOnly ? "#eee" : "#fff" };
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {multiline ? (
        <textarea rows={4} style={style} value={value} readOnly={readOnly} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input style={style} value={value} readOnly={readOnly} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function ReviewPage({ session, draftId }) {
  // Nov 11, 2026, v52, Phase 2 member mode: one review page,
  // two modes. A pastor reviews to Approve and Lock; a member
  // reviews to save a personal study, which is never locked
  // and never carries a church name. The mode comes from the
  // signed-in account, never from the draft file.
  const isMember = session?.role === "member";
  const pageTitle = isMember ? "Flockpath: my personal study" : "Flockpath: pastor review";
  // Nov 3, 2026, agent-test fix W1: when a draft id is given,
  // the page used to render the Genesis demo draft first and
  // swap in the real draft only after the fetch resolved, so
  // a pastor editing in that window edited the wrong pack,
  // and a failed fetch still left the editable demo on
  // screen. Now a draft page starts with no pack at all and
  // renders a loading state (or an error-only view) until the
  // fetch resolves.
  // Nov 4, 2026, new-account landing (Mac test item 5):
  // with no draft id, the page no longer loads the Genesis
  // demo draft either. A pastor who just signed in sees
  // nothing to review, and a plain pointer to Start a pack,
  // instead of a demo pack that looks like their own work.
  // The Genesis demo pack is still viewable any time at
  // /pack/generated-genesis-1, linked from the sign-in page.
  const [pack, setPack] = useState(null);
  // Nov 3, 2026, agent-test fix W2: Reset used to restore the
  // Genesis demo even for a worker draft, dropping the session
  // prefill. The loaded draft is kept here so Reset restores
  // it, not the demo.
  const [initialPack, setInitialPack] = useState(null);
  // Nov 1, 2026, review-before-lock: when a draft id is given,
  // the page loads that worker draft instead of the Genesis
  // demo draft, with its own merged verse store. Scripture
  // text still refills from the store, never from typed text.
  // Allowed references are that draft's own verses, so a day's
  // verse can only be swapped among the confirmed plan's verses.
  const [store, setStore] = useState(verseStore);
  const [allowedRefs, setAllowedRefs] = useState(ALLOWED_REFS);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [draftError, setDraftError] = useState("");
  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/drafts?id=${draftId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) { setDraftError(data.error || "Draft not found."); setDraftLoading(false); return; }
        const p = displayNames(JSON.parse(JSON.stringify(data.draft)));
        if (session?.name) p.pastorName = session.name;
        if (session?.church) p.church = session.church;
        // Nov 11, 2026, v52: the mode comes from the signed-in
        // account, not the draft file. A member reviewing their
        // own draft gets a member pack (first name, no church,
        // no logo); a pastor opening a member-submitted draft
        // gets a pastor pack, because the pastor locks it as a
        // church pack. The draft file never decides the mode.
        if (isMember) {
          p.mode = "member";
          p.memberName = session.name;
          p.church = "";
          delete p.churchLogo;
        } else {
          p.mode = "pastor";
          delete p.memberName;
        }
        setMemberSubmitted(Boolean(data.memberSubmitted));
        setSubmittedBy(data.submittedBy ?? "");
        // Nov 11, 2026, v53: the note verse renders in the
        // draft's own language (the pack is not in state yet
        // here, so the language comes from the loaded draft).
        setNoteRef(p.pastorNote?.verse?.reference ? fullRef(p.pastorNote.verse.reference, data.draft.language ?? "en") : "");
        setNoteVerseStatus(p.pastorNote?.verse?.text ? "found" : "");
        setPack(p);
        setInitialPack(JSON.parse(JSON.stringify(p)));
        setStore(data.verseStore);
        const refs = [p.memoryVerse.reference, ...p.adultDevotionals.map((d) => d.scripture.reference)];
        setAllowedRefs([...new Set(refs)]);
        setDraftLoading(false);
      })
      .catch(() => { setDraftError("Could not load this draft."); setDraftLoading(false); });
  }, [draftId]);
  const [locked, setLocked] = useState(null);
  const [saved, setSaved] = useState("");
  const [lockError, setLockError] = useState("");
  const [pdfLink, setPdfLink] = useState("");
  // Nov 11, 2026, v52: member-mode state. savedPersonal is
  // the saved personal-study entry (never a lock); the member
  // can edit again after saving, and re-saving overwrites
  // the same entry. memberSubmitted marks a draft a member
  // sent to this pastor through the bridge.
  const [savedPersonal, setSavedPersonal] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [memberSubmitted, setMemberSubmitted] = useState(false);
  const [submittedBy, setSubmittedBy] = useState("");

  // Nov 1, 2026, section toggles: unchecked means omitted
  // from the final pack, not broken. A day is adult plus kid
  // together. Memory verse cannot be unchecked. At least one
  // day must stay, otherwise there is no pack to lock.
  const [toggles, setToggles] = useState({ days: {}, leader: true, song: true, classic: true, coloring: true, coverNote: true });
  // Nov 5, 2026, round-5: a pastor can accept a warning
  // ("This is fine") instead of editing or unchecking.
  // Accepted warnings are plain-text keys, so an edit that
  // changes the warning brings the flag back for a fresh
  // look. Session-only, like the toggles: Reset clears them,
  // and they never enter the locked pack.
  const [acceptedWarnings, setAcceptedWarnings] = useState([]);
  const acceptedSet = new Set(acceptedWarnings);
  const acceptWarning = (w) => { if (!acceptedSet.has(w)) setAcceptedWarnings((a) => [...a, w]); };
  const unacceptWarning = (w) => setAcceptedWarnings((a) => a.filter((x) => x !== w));
  // Nov 5, 2026, v32: Rewrite a section that quotes its verse
  // verbatim. Jeremiah's request: when the review page flags
  // an adult body for quoting its verse, the pastor should be
  // able to click Rewrite and have the model rewrite just the
  // offending paragraph(s) in its own words, instead of
  // deleting a whole paragraph by hand (a large edit that
  // defeats the purpose of the app). The verse is never in the
  // model prompt, so it cannot be quoted again from the
  // prompt, and the worker verifies the result against the
  // verse before returning it. State is keyed by day: status
  // plus the rewrite id, so clicking again while one is
  // running resumes polling the same request instead of
  // queuing a duplicate. The quality check re-runs when the
  // pack changes, so a fixed section clears its own flag.
  const [rewriteState, setRewriteState] = useState({});
  // Nov 11, 2026, v54, Phase 4 audio narration: on-demand
  // narration from the review page. The POST takes a few
  // minutes for a whole week (local CPU synthesis), so the
  // page waits with a plain message. On load, the page asks
  // the GET route whether this draft already has audio, so
  // the players show again without re-narrating.
  const [narration, setNarration] = useState({ status: "idle", files: [], message: "" });
  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/narrate?draftId=${draftId}`).then((r) => r.json()).then((d) => {
      if (d.ok && Array.isArray(d.files) && d.files.length) setNarration({ status: "done", files: d.files, message: "" });
    }).catch(() => {});
  }, [draftId]);
  const narratePack = async () => {
    if (!draftId) return;
    setNarration((n) => ({ ...n, status: "running", message: "" }));
    try {
      const res = await fetch("/api/narrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId }) });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error || "Narration failed.");
      setNarration({ status: "done", files: Array.isArray(data.files) ? data.files : [], message: "" });
    } catch (e) {
      setNarration((n) => ({ ...n, status: "failed", message: e.message || "Narration failed." }));
    }
  };
  const rewriteDayBody = async (day) => {
    const a = (pack?.adultDevotionals ?? []).find((d) => d.day === day);
    if (!a) return;
    try {
      let id = rewriteState[day]?.id;
      if (!id) {
        const res = await fetch("/api/rewrite", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId, day, body: a.body, verseRef: a.scripture.reference, verseText: a.scripture.text, language: lang }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Could not start the rewrite.");
        id = data.id;
      }
      setRewriteState((s) => ({ ...s, [day]: { status: "running", id, message: "Rewriting this section in fresh words. This takes about 2-3 minutes." } }));
      let result = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const poll = await fetch(`/api/rewrite?id=${id}`).then((r) => r.json()).catch(() => ({}));
        if (poll.status === "done" && poll.result) { result = poll.result; break; }
        if (poll.status === "failed") throw new Error("The rewrite failed. Try again, or edit the section by hand.");
      }
      if (!result) throw new Error("The rewrite is still running. Click Rewrite again in a minute to check on it.");
      if (result.body && result.body !== a.body) {
        set((p) => { const d = p.adultDevotionals.find((x) => x.day === day); if (d) d.body = result.body; });
      }
      setRewriteState((s) => ({ ...s, [day]: { status: "done", id, message: result.note || "Rewritten. Check the new wording below." } }));
    } catch (e) {
      setRewriteState((s) => ({ ...s, [day]: { status: "error", id: rewriteState[day]?.id, message: String(e.message || e) } }));
    }
  };
  // Nov 5, 2026, round-3 cover note: the verse the pastor
  // types for his own note lives in component state until
  // it resolves, because the pack only ever carries a
  // verse whose text came from the store.
  const [noteRef, setNoteRef] = useState("");
  const [noteVerseStatus, setNoteVerseStatus] = useState(""); // "" | "checking" | "found" | "not-found" | "unknown-book"
  // Nov 11, 2026, v53: the pack's language picks the
  // review chrome (STR_ES vs STR_EN), the day names, and
  // the translation the gates and the note verse use. A
  // legacy pack carries neither and stays English/BSB.
  const isEs = pack?.language === "es";
  const lang = isEs ? "es" : "en";
  const packTranslation = pack?.translation ?? "bsb";
  const T = isEs ? STR_ES : STR_EN;
  const dayName = (d) => (isEs ? (DAY_ES[d] ?? d) : d);
  const fr = (code) => fullRef(code, lang);
  const dayNames = pack ? pack.adultDevotionals.map((d) => d.day) : [];
  // Nov 11, 2026, v54, Phase 4 flexible length: the "get ready
  // for Sunday" note sits on the last day before Sunday:
  // Wednesday for a 3-day pack, Friday for 5, Saturday for 7.
  // A 7-day pack ends on Sunday, so Saturday carries it.
  const lookAheadDay = (() => {
    if (!dayNames.length) return "Friday";
    const last = dayNames[dayNames.length - 1];
    return last === "Sunday" ? "Saturday" : last;
  })();
  const toggleDay = (day) => {
    setToggles((t) => {
      const days = { ...t.days };
      const currentlyOn = days[day] !== false;
      const onCount = dayNames.filter((d) => (days[d] !== false)).length;
      if (currentlyOn && onCount <= 1) return t;
      days[day] = !currentlyOn;
      return { ...t, days };
    });
  };
  const isDayOn = (day) => toggles.days[day] !== false;
  const filteredPack = useMemo(() => {
    if (!pack) return null;
    const p = JSON.parse(JSON.stringify(pack));
    p.adultDevotionals = p.adultDevotionals.filter((d) => isDayOn(d.day));
    p.kidDevotionals = p.kidDevotionals.filter((d) => isDayOn(d.day));
    // Nov 5, 2026, round-5: leader questions belong to days
    // (one per day, in day order), so an unchecked day's
    // question leaves with it. A 2-day pack no longer prints
    // leader questions about verses that are not in it.
    if (!toggles.leader) p.leaderQuestions = [];
    else p.leaderQuestions = leaderQuestionsForDays(p.leaderQuestions, dayNames, new Set(dayNames.filter(isDayOn)));
    if (!toggles.song) { delete p.hymn; delete p.chorus; }
    if (!toggles.classic) {
      delete p.classicDevotional;
      // Nov 2, 2026, denomination labels: unchecking the classic
      // devotional also removes the devotional voices from the
      // Voices section and the PDF sources list, so the locked
      // pack never lists a voice it does not print.
      if (p.phosVoices) p.phosVoices = { ...p.phosVoices, devotionals: [] };
    }
    if (!toggles.coloring) delete p.coloring;
    // Nov 5, 2026, round-3 cover note: unchecking the cover
    // note omits the whole block from the pack, like the
    // other sections. An empty summary, or a pastor note
    // without a verified verse or any words, also prints
    // nothing, so it is dropped here rather than locking a
    // pack with a half-filled note. The draft in state keeps
    // what the pastor typed, so nothing is lost.
    if (!toggles.coverNote) { delete p.sermonSnapshot; delete p.pastorNote; }
    if (!(p.sermonSnapshot?.summary ?? "").trim()) delete p.sermonSnapshot;
    if (!p.pastorNote?.verse?.text || !(p.pastorNote?.note ?? "").trim()) delete p.pastorNote;
    // Nov 11, 2026, v52: a pastor lock keeps only the chosen
    // hymn, so candidates leave with the lock. A member save
    // keeps them: the bridge carries the choice list, so the
    // pastor who opens it can pick a different song.
    if (!isMember) delete p.hymnCandidates;
    return p;
  }, [pack, toggles]);

  const scripture = useMemo(() => (filteredPack ? verifyPack(filteredPack, store, packTranslation) : { ok: false, errors: [] }), [filteredPack, store, packTranslation]);
  const quality = useMemo(() => (filteredPack ? checkQuality(filteredPack) : { ok: false, issues: [], warnings: [] }), [filteredPack]);
  const canLock = Boolean(filteredPack) && scripture.ok && quality.ok && !locked;
  // Nov 11, 2026, v52: the member's save gate is the same
  // two checks (Scripture exactness, originality), with no
  // lock at the end. A member pack is saved, never locked.
  const canSave = Boolean(filteredPack) && scripture.ok && quality.ok && !savedPersonal;
  // Nov 12, 2026, v55: the checks-cleared bar counts the two
  // gates (Scripture exactness, originality). Advisory warnings
  // never count toward it and never block locking.
  const gatesPassed = (scripture.ok ? 1 : 0) + (quality.ok ? 1 : 0);
  // Pastor-facing check text: blocking problems in plain
  // words; length checks kept out of the page, into the log.
  const plainScripture = scripture.errors.map((e) => plainScriptureError(e, lang));
  const plainIssues = quality.issues.map(plainIssue);
  const shownWarnings = (quality.warnings ?? []).filter((w) => !isLengthCheck(w)).map(plainWarning);
  const hiddenWarningCount = (quality.warnings ?? []).filter(isLengthCheck).length;
  // Nov 5, 2026, round-5: warnings the pastor accepted
  // ("This is fine") leave the red lists and show muted
  // below with an Undo, so a reviewed warning never nags
  // twice in one session. Blocks can never be accepted.
  const activeWarnings = shownWarnings.filter((w) => !acceptedSet.has(w));
  const acceptedShown = shownWarnings.filter((w) => acceptedSet.has(w));
  // Nov 11, 2026, v54, Phase 4 doctrinal profile: the
  // review-only warnings from the doctrinal check, as plain
  // text keyed by "Day: note" so the accept flow treats them
  // like any other advisory warning. They never block
  // locking, and they never reach a locked pack.
  const doctrinalTexts = (pack?.doctrinalWarnings ?? []).map((w) => `${dayName(w.day)}: ${w.note}`);
  const activeDoctrinal = doctrinalTexts.filter((t) => !acceptedSet.has(t));
  const acceptedDoctrinal = doctrinalTexts.filter((t) => acceptedSet.has(t));
  const flagsForDay = (day) => ({
    issues: plainIssues.filter((t) => mentionsDay(t, day)),
    warnings: [...activeWarnings.filter((t) => mentionsDay(t, day)), ...activeDoctrinal.filter((t) => mentionsDay(t, day))],
  });
  const leaderFlags = {
    issues: plainIssues.filter((t) => /Leader|líder/i.test(t)),
    warnings: activeWarnings.filter((t) => /Leader|líder/i.test(t)),
  };
  // Nov 4, 2026, review logging (Mac test items 19, 30):
  // the full check detail, including the length checks the
  // pastor no longer sees, is posted to the server log
  // whenever the verdict changes. Fire-and-forget: a logging
  // failure never disturbs the review page.
  const lastLogged = useRef("");
  useEffect(() => {
    if (!pack) return;
    const signature = JSON.stringify({
      draftId: draftId || null,
      scriptureOk: scripture.ok, scriptureErrors: scripture.errors,
      qualityOk: quality.ok, issues: quality.issues, warnings: quality.warnings ?? [],
    });
    if (signature === lastLogged.current) return;
    lastLogged.current = signature;
    fetch("/api/review-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draftId || null, scripture, quality }),
    }).catch(() => {});
  }, [pack, draftId, scripture, quality]);

  // Loading and error views for a draft page. These returns
  // sit after every hook above, so hook order never changes.
  if (draftId && draftLoading) {
    return (
      <main className="fp-main">
        <JourneyStrip stage="review" member={isMember} />
        <h1>{pageTitle}</h1>
        <p>Loading your draft...</p>
      </main>
    );
  }
  if (draftId && draftError) {
    return (
      <main className="fp-main">
        <JourneyStrip stage="review" member={isMember} />
        <h1>{pageTitle}</h1>
        <p><strong>{draftError}</strong></p>
        <p>This draft may belong to another pastor, or it may already have been locked. Nothing is shown for editing until the draft loads.</p>
      </main>
    );
  }
  if (!pack) {
    return (
      <main className="fp-main">
        <JourneyStrip stage="review" member={isMember} />
        <h1>{pageTitle}</h1>
        <p>Nothing to review yet.</p>
        <p>Go to <a href="/input">Start a pack</a> to generate a new pack. When a build finishes, its draft opens here for your review.</p>
      </main>
    );
  }

  const set = (fn) => setPack((p) => { const n = JSON.parse(JSON.stringify(p)); fn(n); return n; });

  // Nov 5, 2026, round-3 cover note: resolve the verse the
  // pastor typed for his own note. The typed words are
  // parsed to a code reference, the exact BSB text is
  // fetched from the store, and the verse joins the review
  // store, so the Scripture gate can verify it like any
  // other verse. A verse that cannot be found leaves the
  // note unprintable, and the section says so plainly,
  // rather than locking a misquote.
  const wordCount = (s) => String(s ?? "").split(/\s+/).filter(Boolean).length;
  const normText = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // Nov 5, 2026, v26, Jeremiah's call: a pastor who
  // pastes a quote WITH quotation marks saw the pack
  // refuse to lock, because the check compares the
  // quote against the sermon text and the marks are
  // not in the sermon. Quotation marks are added at
  // print time (the PDF wraps the quote), so they are
  // stripped on input here and in the lock check, and
  // never stored. Only double quotes are stripped;
  // single quotes can be part of the words.
  const stripQuoteMarks = (s) => String(s ?? "").trim().replace(/^["\u201c\u201d]+/, "").replace(/["\u201c\u201d]+$/, "").trim();
  const quoteMatchesSermon = !pack?.sermonSnapshot?.quote || !pack?.sermonText || normText(pack.sermonText).includes(normText(stripQuoteMarks(pack.sermonSnapshot.quote)));

  async function resolveNoteVerse(refInput) {
    const code = parseRef(refInput);
    if (!code) { setNoteVerseStatus("unknown-book"); return; }
    setNoteVerseStatus("checking");
    try {
      // Nov 11, 2026, v53: the note verse resolves from the
      // pack's own translation, so a Spanish pack's note
      // verse is Spanish text from the Spanish store.
      const res = await fetch(`/api/verse?ref=${encodeURIComponent(code)}&translation=${encodeURIComponent(packTranslation)}`);
      const data = await res.json().catch(() => ({}));
      if (!data.ok || !data.text) {
        setNoteVerseStatus("not-found");
        set((p) => { if (p.pastorNote) p.pastorNote.verse = { reference: code, translation: packTranslation, text: "" }; });
        return;
      }
      setStore((s) => ({ ...s, [code]: data.text }));
      set((p) => { p.pastorNote = { ...(p.pastorNote ?? { note: "" }), verse: { reference: code, translation: packTranslation, text: data.text } }; });
      setNoteVerseStatus("found");
    } catch {
      setNoteVerseStatus("not-found");
    }
  }

  async function onLock() {
    setLockError("");
    // Nov 11, 2026, v52: a member has no lock button, so this
    // is unreachable in the UI. The guard stays as a backstop:
    // a member pack must never reach lockPack at all.
    if (isMember) return;
    // Nov 4, 2026, blocked lock feedback (Mac test items
    // 21, 22): the old button was disabled while blocked, so
    // tapping it did nothing and said nothing. Now the
    // button always answers: when a check blocks, tapping it
    // shows the plain reason right here, next to the button.
    if (!canLock) {
      const first = plainScripture[0] || plainIssues[0] || "A check has not passed yet.";
      setLockError(`Not ready to lock yet: ${first} Fix it, or uncheck that section, then try again.`);
      return;
    }
    const result = lockPack(filteredPack, store, packTranslation);
    // Nov 3, 2026, agent-test fix W3: a failed lock used to
    // return silently, leaving the pastor with no explanation.
    // A lock can still fail (a required field cleared, for
    // example), so the error now shows next to the button.
    if (!result.ok) { setLockError(result.errors?.join(" ") || "Lock failed. Check the gates above."); return; }
    setLocked(result.pack);
    // Step 7: a locked pack saves itself to this pastor's library.
    try {
      const res = await fetch("/api/packs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: result.pack.id, title: result.pack.title, passage: result.pack.passage, status: "locked", lockHash: result.pack.lockHash, pack: result.pack }),
      });
      setSaved(res.ok ? T.savedToLibrary : "Locked, but not saved to the library. Try the library page again.");
      // Nov 2, 2026, pastor-test fix: a locked pack must get
      // a print PDF without a manual build step. Build it
      // here, after the library save, from the locked pack
      // itself. A PDF failure does not un-lock the pack;
      // the pastor can retry from the pack page.
      if (res.ok) {
        try {
          const pdfRes = await fetch("/api/packs/pdf", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: result.pack.id }),
          });
          const pdfJson = await pdfRes.json().catch(() => ({}));
          if (pdfJson.ok) setPdfLink(pdfJson.pdf);
          else setSaved("Saved to your packs library. Print PDF build failed, retry from the pack page.");
        } catch {
          setSaved("Saved to your packs library. Print PDF build failed, retry from the pack page.");
        }
      }
      // Review-before-lock: a draft that has just been locked
      // is no longer pending review, so remove it. If the
      // delete fails, the draft stays listed, which is safe:
      // it can be opened again, but it cannot overwrite the
      // locked pack, because locking always creates a new lock.
      if (res.ok && draftId) {
        try { await fetch(`/api/drafts?id=${draftId}`, { method: "DELETE" }); } catch {}
      }
    } catch {
      setSaved("Locked, but not saved to the library.");
    }
  }

  // Nov 11, 2026, v52, Phase 2 member mode: saving a
  // personal study. Same two gates as the lock (Scripture
  // exactness, originality), but the save mints no hash and
  // writes no lock: the entry is personal, and the PDF
  // carries the mandatory label instead of an approval code.
  // Re-saving overwrites the same entry, so a member can
  // edit after saving and save again.
  async function onSavePersonal() {
    setSaveError("");
    if (!canSave) {
      const first = plainScripture[0] || plainIssues[0] || "A check has not passed yet.";
      setSaveError(`Not ready to save yet: ${first} Fix it, or uncheck that section, then try again.`);
      return;
    }
    try {
      const res = await fetch("/api/packs/personal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: filteredPack }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setSaveError(data.error || "Could not save this study."); return; }
      setSavedPersonal(data.entry);
      setSaved(isEs ? "Guardado como tu estudio personal." : "Saved as your personal study.");
      try {
        const pdfRes = await fetch("/api/packs/pdf", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: filteredPack.id }),
        });
        const pdfJson = await pdfRes.json().catch(() => ({}));
        if (pdfJson.ok) setPdfLink(pdfJson.pdf);
        else setSaved("Saved as your personal study. Print PDF build failed, retry from the My packs page.");
      } catch {
        setSaved("Saved as your personal study. Print PDF build failed, retry from the My packs page.");
      }
    } catch {
      setSaveError("Could not save this study.");
    }
  }

  // Nov 11, 2026, v52: the send-to-pastor bridge, member
  // side. Downloads the draft file (references only, never
  // Scripture text) so the member can send it to their
  // pastor by their own email. Flockpath sends nothing itself.
  function onExportBridge() {
    if (!filteredPack) return;
    const bridge = exportBridgeDraft(filteredPack, session?.name || "");
    const blob = new Blob([JSON.stringify(bridge, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flockpath-member-draft-${filteredPack.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Nov 11, 2026, v52: the pastor's rejection path for a
  // member-submitted draft. Rejecting deletes the draft; it
  // is never locked, never saved, and nothing is sent back
  // to the member (the pastor tells them, if they want to).
  async function onRejectMemberDraft() {
    if (!draftId) return;
    if (!window.confirm(`Reject this draft from ${submittedBy || "a member"}? It will be deleted, and nothing will be sent back.`)) return;
    try {
      const res = await fetch(`/api/drafts?id=${draftId}`, { method: "DELETE" });
      if (res.ok) window.location.href = "/packs";
    } catch {}
  }

  function onUnlock() {
    setLocked(null);
    set((p) => { p.status = "draft"; });
  }

  function onReset() {
    setLocked(null);
    setSavedPersonal(null);
    if (initialPack) {
      setPack(JSON.parse(JSON.stringify(initialPack)));
      setNoteRef(initialPack.pastorNote?.verse?.reference ? fullRef(initialPack.pastorNote.verse.reference, initialPack.language ?? "en") : "");
      setNoteVerseStatus(initialPack.pastorNote?.verse?.text ? "found" : "");
    }
    setToggles({ days: {}, leader: true, song: true, classic: true, coloring: true, coverNote: true });
    setAcceptedWarnings([]);
  }

  const ro = Boolean(locked) || Boolean(savedPersonal);

  // Nov 5, 2026, round-2 task order: the lock button used
  // to sit only at the top, in the checks section, while
  // the fields it locks sat below it, so a pastor edited
  // down the page and had to scroll back up to lock. The
  // same approve/locked block now renders at the bottom
  // of the page too, so the next action is always the
  // next thing down, never a jump back up.
  // Nov 11, 2026, v52: the member's approve area is a save
  // area. No Approve and Lock button is ever rendered for a
  // member, and no approval code is ever shown. The member
  // saves a personal study, downloads its print PDF, and can
  // send the draft to their pastor from here.
  const memberApproveArea = savedPersonal ? (
    <div>
      <p><strong>{T.savedPersonalLine}</strong></p>
      {saved && <p>{saved}</p>}
      {pdfLink && <p><a href={pdfLink}>{T.downloadPdf}</a></p>}
      <p><a href="/packs">{T.viewStudies}</a></p>
      <p><button onClick={onExportBridge}>{T.sendToPastor}</button> Download the draft file and send it to your pastor by email. Your pastor opens it in Flockpath, reviews it, and can lock it as a church pack.</p>
      <button onClick={() => setSavedPersonal(null)}>{T.editAgain}</button>
    </div>
  ) : (
    <div>
      <button onClick={onSavePersonal} className="fp-btn-green fp-btn-mobile-block" style={{ padding: "10px 18px", fontSize: 16 }}>
        {T.saveButton}
      </button>
      {saveError && <p><strong>{saveError}</strong></p>}
      {!canSave && !saveError && <p>One of the checks above needs fixing before this study can save. Tap the button and it will tell you which one.</p>}
      <p><button onClick={onExportBridge}>{T.sendToPastor}</button> Download the draft file and send it to your pastor by email. Your pastor opens it in Flockpath, reviews it, and can lock it as a church pack.</p>
    </div>
  );

  const approveArea = isMember ? memberApproveArea : locked ? (
    <div>
      <p><strong>{T.lockedLine(locked.pastorName, locked.church)}</strong></p>
      <p>{T.approvalCode} <code>{locked.lockHash}</code></p>
      {saved && <p>{saved}</p>}
      {pdfLink && <p><a href={pdfLink}>{T.downloadPdf}</a></p>}
      <p><a href={`/pack/${packSlug(locked, locked.id)}`}>{T.viewShare}</a> | <a href="/packs">{T.viewLibrary}</a></p>
      <button onClick={onUnlock}>{T.unlockButton}</button>
    </div>
  ) : (
    <div>
      <button onClick={onLock} className="fp-btn-green fp-btn-mobile-block" style={{ padding: "10px 18px", fontSize: 16 }}>
        {T.lockButton}
      </button>
      {lockError && <p><strong>{lockError}</strong></p>}
      {!canLock && !lockError && <p>One of the checks above needs fixing before this pack can lock. Tap the button and it will tell you which one.</p>}
    </div>
  );

  return (
    <main className="fp-main">
      <JourneyStrip stage={locked ? "share" : savedPersonal ? "save" : "review"} member={isMember} />
      <h1>{isMember ? T.titleMember : T.titlePastor}</h1>
      <p>{isMember ? T.introMember : T.introPastor}</p>
      {draftId && <p><strong>This is a draft for your review, not a finished pack.</strong> {isMember ? T.draftNoteMember : T.draftNotePastor}</p>}
      {memberSubmitted && !isMember && (
        <p><strong>Sent by {submittedBy} for your review.</strong> This draft came from a member&apos;s personal study. Review it like any draft. If you approve and lock it, it becomes a church pack with your name and church. <button type="button" onClick={onRejectMemberDraft}>Reject this draft</button></p>
      )}

      <section className="fp-checks-card">
        <h2 style={{ marginTop: 0 }}>{T.checksHeading}</h2>
        <p>{T.checksIntro}</p>
        <div className="fp-checks-bar" role="img" aria-label={T.checksCleared(gatesPassed)}>
          <div className="fp-checks-fill" style={{ width: `${(gatesPassed / 2) * 100}%` }} />
        </div>
        <p><strong>{T.checksCleared(gatesPassed)}</strong></p>
        <p className="fp-check-row"><strong>{T.scriptureLabel}</strong> <span className={scripture.ok ? "fp-check-ok" : "fp-check-need"}>{scripture.ok ? T.scriptureOk : T.scriptureNeed}</span></p>
        {!scripture.ok && <ul>{plainScripture.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <p className="fp-check-row"><strong>{T.daysLabel}</strong> <span className={quality.ok ? "fp-check-ok" : "fp-check-need"}>{quality.ok ? T.daysOk : T.daysNeed}</span></p>
        {!quality.ok && <ul>{plainIssues.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        {activeWarnings.length ? <div className="fp-gold-box"><p style={{ marginTop: 0 }}><strong>{T.secondLook}</strong></p><ul>{activeWarnings.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => acceptWarning(w)}>{T.thisIsFine}</button></li>)}</ul><p style={{ marginBottom: 0 }}>{T.secondLookNote}</p></div> : null}
        {activeDoctrinal.length ? <div className="fp-gold-box"><p style={{ marginTop: 0 }}><strong>{T.doctrinalHeading}</strong></p><p>{T.doctrinalIntro}</p><ul>{activeDoctrinal.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => acceptWarning(w)}>{T.thisIsFine}</button></li>)}</ul></div> : null}
        {acceptedDoctrinal.length ? <div><p><strong>{T.doctrinalHeading} {T.checkedByYou}</strong></p><ul>{acceptedDoctrinal.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => unacceptWarning(w)}>Undo</button></li>)}</ul></div> : null}
        {acceptedShown.length ? <div><p><strong>{T.checkedByYou}</strong></p><ul>{acceptedShown.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => unacceptWarning(w)}>Undo</button></li>)}</ul></div> : null}
        {hiddenWarningCount > 0 && <p>{T.lengthNotes(hiddenWarningCount)}</p>}
        <p><strong>{T.packIncludes(filteredPack.adultDevotionals.length, pack.adultDevotionals.length)}</strong></p>
        {approveArea}
        <p><button onClick={onReset}>{T.resetButton}</button></p>
      </section>

      <section className="fp-card">
        <h2 style={{ marginTop: 0 }}>{T.narrationHeading}</h2>
        <p>{T.narrationIntro}</p>
        {isEs ? (
          <p>{T.narrationUnavailable}</p>
        ) : (
          <>
            {narration.status === "running" ? <p>{T.narrationRunning}</p> : <p><button type="button" onClick={narratePack} disabled={narration.status === "running"}>{T.narrationButton}</button></p>}
            {narration.status === "failed" && narration.message ? <p>{narration.message}</p> : null}
            {narration.files.length ? (
              <ul>
                {narration.files.map((f) => (
                  <li key={f.file} style={{ marginBottom: 12 }}>
                    {f.day ? `${dayName(f.day)} - ${f.kind === "kid" ? T.narrationKid : T.narrationAdult}` : f.file}{f.seconds ? ` (${Math.floor(f.seconds / 60)}:${String(Math.round(f.seconds % 60)).padStart(2, "0")})` : ""}
                    <br />
                    <audio controls preload="none" src={`/api/narration/${draftId}/${f.file}`} style={{ width: "100%", marginTop: 4 }} />
                    <br />
                    <a href={`/api/narration/${draftId}/${f.file}`} download={f.file}>{T.narrationDownload}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section className="fp-card">
        <h2 style={{ marginTop: 0 }}>{T.sectionsHeading}</h2>
        <p>{T.sectionsIntro}</p>
        {pack.adultDevotionals.map((a) => (
          <p key={a.day}><label><input type="checkbox" checked={isDayOn(a.day)} disabled={ro} onChange={() => toggleDay(a.day)} /> {dayName(a.day)}: {a.title} ({fr(a.scripture.reference)})</label></p>
        ))}
        <p><label><input type="checkbox" checked={toggles.leader} disabled={ro} onChange={() => setToggles((t) => ({ ...t, leader: !t.leader }))} /> {T.leaderToggle}</label></p>
        <p><label><input type="checkbox" checked={toggles.song} disabled={ro} onChange={() => setToggles((t) => ({ ...t, song: !t.song }))} /> {T.songToggle}</label></p>
        {pack.classicDevotional && <p><label><input type="checkbox" checked={toggles.classic} disabled={ro} onChange={() => setToggles((t) => ({ ...t, classic: !t.classic }))} /> Classic devotional: {pack.classicDevotional.title}{pack.classicDevotional.tradition_label ? ` (${pack.classicDevotional.tradition_label})` : ""}</label></p>}
        <p><label><input type="checkbox" checked={toggles.coloring} disabled={ro} onChange={() => setToggles((t) => ({ ...t, coloring: !t.coloring }))} /> {T.coloringToggle}</label></p>
        <p><label><input type="checkbox" checked={toggles.coverNote} disabled={ro} onChange={() => setToggles((t) => ({ ...t, coverNote: !t.coverNote }))} /> {T.coverNoteToggle}</label></p>
        <p><label><input type="checkbox" checked disabled /> {T.memoryAlways(fr(pack.memoryVerse.reference))}</label></p>
      </section>

      {(filteredPack.phosVoices?.commentary?.length || filteredPack.phosVoices?.devotionals?.length || filteredPack.classicDevotional?.tradition_label) ? (
        <section className="fp-card">
          <h2 style={{ marginTop: 0 }}>{T.voicesHeading}</h2>
          <p>These are the study voices that shaped this draft. Your tradition setting put your tradition&apos;s voices first for this draft. To change voices for a future pack, change your tradition on My packs. Every voice is labeled so you can judge it: a label is a fact about the author, not an endorsement of every view.</p>
          {filteredPack.classicDevotional ? (
            <p><strong>Classic devotional:</strong> {filteredPack.classicDevotional.workTitle || filteredPack.classicDevotional.title}{filteredPack.classicDevotional.tradition_label ? ` (${filteredPack.classicDevotional.tradition_label})` : ""}</p>
          ) : null}
          {filteredPack.phosVoices?.commentary?.length ? (
            <div>
              <p><strong>Commentary voices:</strong></p>
              <ul>
                {filteredPack.phosVoices.commentary.map((v) => (
                  <li key={v.source}>{v.title}{v.tradition_label ? ` (${v.tradition_label})` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {filteredPack.phosVoices?.devotionals?.length ? (
            <div>
              <p><strong>Devotional voices in the rotation:</strong></p>
              <ul>
                {filteredPack.phosVoices.devotionals.map((v) => (
                  <li key={v.source}>{v.title}{v.tradition_label ? ` (${v.tradition_label})` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <Field label={T.packTitle} value={pack.title} readOnly={ro} onChange={(v) => set((p) => { p.title = v; })} />
        <Field label={T.passage} value={pack.passage} readOnly={ro} onChange={(v) => set((p) => { p.passage = v; })} />
        <Field label={isMember ? T.memberName : T.pastorName} value={pack.pastorName} readOnly={ro} onChange={(v) => set((p) => { p.pastorName = v; if (isMember) p.memberName = v; })} />
        {!isMember && <Field label={T.church} value={pack.church} readOnly={ro} onChange={(v) => set((p) => { p.church = v; })} />}

        <h2>{T.memoryVerseHeading}</h2>
        <p>{fr(pack.memoryVerse.reference)}: {pack.memoryVerse.text}</p>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{T.memoryVerseRef}</span>
          <select disabled={ro} value={pack.memoryVerse.reference} onChange={(e) => set((p) => { p.memoryVerse = fillVerse(e.target.value, store, packTranslation); })}>
            {allowedRefs.map((r) => <option key={r} value={r}>{fr(r)}</option>)}
          </select>
        </label>

        <section className="fp-card">
          <h2 style={{ marginTop: 0 }}>{T.coverHeading}</h2>
          <p>One short block on the cover page, under the memory verse. {pack.sermonSnapshot?.summary?.trim() ? "Your sermon gave this draft a short summary and one quote, shown below. Edit them here. The cover prints the sermon summary." : "This draft has no sermon summary, so the cover stays plain unless you write your own note below."}</p>
          {pack.sermonSnapshot ? (
            <div>
              <Field label="Sermon summary (at most 45 words)" multiline maxLength={320} value={pack.sermonSnapshot.summary} readOnly={ro} onChange={(v) => set((p) => { p.sermonSnapshot.summary = v; })} />
              <p>{wordCount(pack.sermonSnapshot.summary)} words.</p>
              <Field label="Quote from the sermon (at most 30 words, exact words)" multiline maxLength={220} value={pack.sermonSnapshot.quote ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.sermonSnapshot.quote = stripQuoteMarks(v); })} />
              <p>Quotation marks are added automatically when the pack prints, no need to type them.</p>
              <p>{wordCount(pack.sermonSnapshot.quote ?? "")} words. {pack.sermonSnapshot.quote ? (quoteMatchesSermon ? "Matches the sermon you pasted." : "This quote does not match the sermon text. Fix it, or clear it, or the pack cannot lock.") : "No quote. Only the summary will print."}</p>
            </div>
          ) : null}
          {/* Nov 5, 2026, v26, Jeremiah's call: one or the
              other, not both. The note section hides when
              a sermon summary is already there, and
              appears when there is none (a topic-built
              pack). A note already filled in still shows,
              so a note written before this change is never
              hidden while it prints. */}
          {(!(pack.sermonSnapshot?.summary ?? "").trim() || (pack.pastorNote?.verse?.text && (pack.pastorNote?.note ?? "").trim())) ? (
            <>
              <h3>Your own note</h3>
              <p>Add a verse and a few words in your own voice. This prints on the cover instead of the sermon summary above.</p>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Verse (for example James 1:4)</span>
                <input style={{ width: "100%", padding: 8, fontSize: 15, border: "1px solid #ccc", borderRadius: 6, background: ro ? "#eee" : "#fff" }} value={noteRef} readOnly={ro} onChange={(e) => setNoteRef(e.target.value)} onBlur={() => { if (noteRef.trim() && !ro) resolveNoteVerse(noteRef); }} />
              </label>
              {noteVerseStatus === "checking" ? <p>Checking the verse…</p> : null}
              {noteVerseStatus === "found" && pack.pastorNote?.verse?.text ? <p>{fr(pack.pastorNote.verse.reference)}: &ldquo;{pack.pastorNote.verse.text}&rdquo;</p> : null}
              {noteVerseStatus === "not-found" ? <p>That verse was not found. Check the chapter and verse.</p> : null}
              {noteVerseStatus === "unknown-book" ? <p>I can&apos;t find that book. Use the full name, like James 1:4.</p> : null}
              <Field label="Your words (at most 40 words)" multiline maxLength={300} value={pack.pastorNote?.note ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.pastorNote = { ...(p.pastorNote ?? { verse: { reference: "", translation: packTranslation, text: "" } }), note: v }; })} />
              <p>{wordCount(pack.pastorNote?.note ?? "")} words.</p>
            </>
          ) : null}
          <p><strong>{!toggles.coverNote ? "The cover note is unchecked, so nothing prints on the cover." : (pack.pastorNote?.verse?.text && (pack.pastorNote?.note ?? "").trim() ? "Your own note will print on the cover." : ((pack.sermonSnapshot?.summary ?? "").trim() ? "The sermon summary will print on the cover." : "Nothing will print on the cover yet. Fill in your note above, or leave it blank."))}</strong></p>
        </section>

        {pack.adultDevotionals.map((a, i) => {
          const k = pack.kidDevotionals[i];
          const day = a.day;
          if (!a || !k) return null;
          const on = isDayOn(day);
          // Nov 4, 2026, section flags (Mac test item 23):
          // a flagged day says so on its own card, so the
          // pastor never has to connect a distant check list
          // to the field that needs fixing.
          const dayFlags = on ? flagsForDay(day) : { issues: [], warnings: [] };
          return (
            <section key={day} className="fp-day-card" style={{ opacity: on ? 1 : 0.55 }}>
              <h2>{dayName(day)}{on ? "" : ` - ${T.dayExcluded}`}</h2>
              {(dayFlags.issues.length > 0 || dayFlags.warnings.length > 0) && (
                <div style={{ color: "darkred" }}>
                  <p><strong>{T.needsLook}</strong></p>
                  {dayFlags.issues.map((t, i) => (
                    <p key={`i${i}`}>{t} {/quotes its verse verbatim|cita su versículo palabra por palabra/.test(t) && (
                      <button type="button" disabled={ro || rewriteState[day]?.status === "running"} onClick={() => rewriteDayBody(day)}>
                        {rewriteState[day]?.status === "running" ? T.rewriting : T.rewriteButton}
                      </button>
                    )}</p>
                  ))}
                  {rewriteState[day]?.message && <p>{rewriteState[day].message}</p>}
                  {dayFlags.warnings.map((t, i) => <p key={`w${i}`}>{t} <button type="button" disabled={ro} onClick={() => acceptWarning(t)}>{T.thisIsFine}</button></p>)}
                </div>
              )}
              <Field label={T.adultTitle} value={a.title} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].title = v; })} />
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{T.adultRef}</span>
                <select disabled={ro} value={a.scripture.reference} onChange={(e) => set((p) => { p.adultDevotionals[i].scripture = fillVerse(e.target.value, store, packTranslation); })}>
                  {allowedRefs.map((r) => <option key={r} value={r}>{fr(r)}</option>)}
                </select>
              </label>
              <p>Scripture text: &ldquo;{a.scripture.text}&rdquo;</p>
              <Field label={T.adultBody} multiline value={a.body} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].body = v; })} />
              <Field label={T.adultPrayer} multiline value={a.prayer} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].prayer = v; })} />
              {day === lookAheadDay && (
                <Field label={T.lookAhead} multiline value={a.lookAhead ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].lookAhead = v; })} />
              )}
              <Field label={T.kidTitle} value={k.title} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].title = v; })} />
              <Field label={T.kidRetelling} multiline value={k.retelling} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].retelling = v; })} />
              <Field label={T.kidActivity} multiline value={k.activity} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].activity = v; })} />
            </section>
          );
        })}

        <h2>{T.leaderHeading}</h2>
        {(leaderFlags.issues.length > 0 || leaderFlags.warnings.length > 0) && (
          <div style={{ color: "darkred" }}>
            <p><strong>{T.needsLook}</strong></p>
            {leaderFlags.issues.map((t, i) => <p key={`i${i}`}>{t}</p>)}
            {leaderFlags.warnings.map((t, i) => <p key={`w${i}`}>{t} <button type="button" disabled={ro} onClick={() => acceptWarning(t)}>{T.thisIsFine}</button></p>)}
          </div>
        )}
        {pack.leaderQuestions.map((q, i) => {
          // Nov 5, 2026, round-5: a question belongs to the
          // day at the same index, so an unchecked day's
          // question shows dimmed and labeled, like an
          // unchecked day card, instead of looking live.
          const qDay = dayNames[i];
          const qOn = toggles.leader && (!qDay || isDayOn(qDay));
          return (
          <div key={i} style={{ opacity: qOn ? 1 : 0.55 }}>
            {!qOn && <p><strong>Question {i + 1}{qDay ? ` (${qDay})` : ""} - excluded from final pack</strong></p>}
            {/* Nov 4, 2026, readability (Mac test item 20):
            questions and notes used to be single-line fields
            that cut long text off mid-word. They are now
            multi-line, so the whole question and note read
            on the page. */}
            <Field label={T.questionLabel(i)} multiline value={q.question} readOnly={ro} onChange={(v) => set((p) => { p.leaderQuestions[i].question = v; })} />
            <Field label={T.leaderNoteLabel} multiline value={q.leaderNote ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.leaderQuestions[i].leaderNote = v; })} />
          </div>
          );
        })}

        {pack.chorus ? (
          <>
            <h2>{T.chorusHeading}</h2>
            <p>New packs do not generate original choruses. This section only shows for a pack locked before that change.</p>
            <Field label="Chorus title" value={pack.chorus.title} readOnly={ro} onChange={(v) => set((p) => { p.chorus.title = v; })} />
            <Field label="ChordPro" multiline value={pack.chorus.chordPro} readOnly={ro} onChange={(v) => set((p) => { p.chorus.chordPro = v; })} />
            <p>Original: {pack.chorus.original ? "yes" : "no - locking will fail"}</p>
          </>
        ) : null}

        {pack.hymnCandidates?.length ? (
          <section className="fp-card">
            <h2>{T.hymnPickHeading}</h2>
            <p>{pack.hymnCandidates.some((h) => h.related) ? "No hymn matched this passage exactly. These public-domain hymns are the closest ones in the index. Pick one if it fits your sermon, or choose no song." : "The system matched these public-domain hymns to this passage. Picking one is a choice, not a fix: the auto-pick is already a verified hymn. If you pick none of them, no song will print."}</p>
            {pack.hymnCandidates.map((h) => (
              <p key={h.id}>
                <button type="button" disabled={ro} onClick={() => set((p) => { p.hymn = { ...h }; delete p.hymn.related; })}>
                  {pack.hymn?.id === h.id ? "Chosen: " : "Use: "}{h.title} ({h.tune})
                </button>
                {" "}Words: {h.author} ({h.authorYears}), {h.wordsYear}. Meter: {h.meter}. Public domain in the US.
              </p>
            ))}
            <p><button type="button" disabled={ro} onClick={() => set((p) => { delete p.hymn; })}>No song for this week</button></p>
            {pack.hymn ? <p><strong>Now chosen:</strong> {pack.hymn.title} ({pack.hymn.tune}). This is the song that will print on page 8.</p> : <p><strong>Now chosen:</strong> no song. No song page will print.</p>}
          </section>
        ) : null}
        {pack.hymn && !pack.hymnCandidates?.length ? (
          <section className="fp-card">
            <h2>{T.hymnHeading}</h2>
            <p>{pack.hymn.title} ({pack.hymn.tune}). Words: {pack.hymn.author} ({pack.hymn.authorYears}), {pack.hymn.wordsYear}. Public domain in the US.</p>
            <p><button type="button" disabled={ro} onClick={() => set((p) => { delete p.hymn; })}>No song for this week</button></p>
          </section>
        ) : null}

        {!pack.hymn && !pack.chorus && !pack.hymnCandidates?.length ? <p>No hymn in the index fits this passage, so no song page will print for this pack.</p> : null}

        <h2>{T.coloringHeading}</h2>
        <Field label={T.coloringTitle} value={pack.coloring.title} readOnly={ro} onChange={(v) => set((p) => { p.coloring.title = v; })} />
        <Field label={T.coloringDesc} multiline value={pack.coloring.description} readOnly={ro} onChange={(v) => set((p) => { p.coloring.description = v; })} />
        {(() => {
          // Nov 1, 2026, coloring preview fix: the old code
          // always previewed creation-sky-earth-v1, even for a
          // Psalm or Romans pack. The preview now shows the
          // matched template for this pack, or the pastor's
          // picked template if they chose one below. The PDF
          // builder respects the same pick, so preview and
          // print can no longer disagree.
          const matched = matchColoring(pack);
          const chosen = COLORING_TEMPLATES[pack.coloring.svgTemplateId] ? pack.coloring.svgTemplateId : matched;
          const tpl = COLORING_TEMPLATES[chosen];
          return (
            <div>
              <p>Template: {chosen} - {tpl.caption}</p>
              <img src={`/coloring/${tpl.file}`} alt={tpl.alt} width={400} style={{ border: "1px solid #ccc", background: "#fff" }} />
              <p>Pick a different coloring page, or keep the matched one. The swap offers the 10-theme PNG library (COLORING-10.md).</p>
              {Object.entries(COLORING_TEMPLATES).map(([id, t]) => (
                <p key={id}>
                  <button type="button" disabled={ro} onClick={() => set((p) => { p.coloring.svgTemplateId = id; p.coloring.description = t.caption; })}>
                    {id === chosen ? "Chosen: " : "Use: "}{t.caption}
                  </button>
                </p>
              ))}
            </div>
          );
        })()}
      </section>

      <section className="fp-checks-card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>{isMember ? T.readySave : T.readyLock}</h2>
        {approveArea}
      </section>
    </main>
  );
}
