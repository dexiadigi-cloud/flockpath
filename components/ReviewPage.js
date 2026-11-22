"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JourneyStrip from "./JourneyStrip";
import NarrationListen from "./NarrationListen";
import { leaderQuestionsForDays, lockPack, packSlug, verifyPack, exportBridgeDraft } from "../lib/pack.mjs";
import { checkQuality } from "../lib/quality.mjs";
import { COLORING_TEMPLATES, matchColoring } from "../lib/coloring.mjs";
import { formatRef, formatRefsInText, parseRef } from "../lib/refs.mjs";
import verseStore from "../data/bsb-GEN.json";
import { useAppLanguage } from "./AppLanguage";
import { t, tf } from "../lib/appStrings.mjs";

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

// Nov 21, 2026, v63: the review chrome moved to the app
// language dictionary (lib/appStrings.mjs, review.* keys),
// read through t() in the signed-in account's app language.
// The pack's own language still picks the day names, the
// gate-error wording, and the translation the gates use
// (v53): those describe the pack, not the app.

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
  const { language: appLanguage } = useAppLanguage();
  // Nov 21, 2026, v63 round 2: the journey strip takes
  // translated labels, like the input page already passed.
  // Without them it fell back to its English defaults.
  const journeyLabels = { start: t(appLanguage, "journey.start"), building: t(appLanguage, "journey.building"), review: t(appLanguage, "journey.review"), approve: t(appLanguage, "journey.approve"), share: t(appLanguage, "journey.share"), save: t(appLanguage, "journey.save"), print: t(appLanguage, "journey.print") };
  const pageTitle = isMember ? t(appLanguage, "review.titleMember") : t(appLanguage, "review.titlePastor");
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
        if (!data.ok) { setDraftError(data.error || t(appLanguage, "review.draftNotFound")); setDraftLoading(false); return; }
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
      .catch(() => { setDraftError(t(appLanguage, "review.draftLoadFailed")); setDraftLoading(false); });
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
  const [toggles, setToggles] = useState({ days: {}, leader: true, song: true, classic: true, places: true, names: true, topics: true, coloring: true, coverNote: true });
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
  // Nov 20, 2026, v62, items 12, 13, 14, 16: narration lives
  // in the shared NarrationListen component (background job
  // with progress, day-grouped players, per-section buttons),
  // used here for the draft and on the pack page for the
  // locked pack. The old blocking POST and flat file list
  // are gone; see components/NarrationListen.js.
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
        if (!data.ok) throw new Error(data.error || t(appLanguage, "review.rewriteStartFail"));
        id = data.id;
      }
      setRewriteState((s) => ({ ...s, [day]: { status: "running", id, message: t(appLanguage, "review.rewritingSection") } }));
      let result = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const poll = await fetch(`/api/rewrite?id=${id}`).then((r) => r.json()).catch(() => ({}));
        if (poll.status === "done" && poll.result) { result = poll.result; break; }
        if (poll.status === "failed") throw new Error(t(appLanguage, "review.rewriteFailed"));
      }
      if (!result) throw new Error(t(appLanguage, "review.rewriteStillRunning"));
      if (result.body && result.body !== a.body) {
        set((p) => { const d = p.adultDevotionals.find((x) => x.day === day); if (d) d.body = result.body; });
      }
      setRewriteState((s) => ({ ...s, [day]: { status: "done", id, message: result.note || t(appLanguage, "review.rewrittenNote") } }));
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
  // day names and the translation the gates and the note
  // verse use. A legacy pack carries neither and stays
  // English/BSB. The review chrome itself follows the
  // app language (v63), not the pack language.
  const isEs = pack?.language === "es";
  const lang = isEs ? "es" : "en";
  const packTranslation = pack?.translation ?? "bsb";
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
    // Nov 19, 2026, Viz.Bible Phase 1: unchecking the places
    // note drops it from the locked pack, and the PDF sources
    // line drops the places entry with it, because build-pdf.mjs
    // gates both on pack.placesNote being present.
    if (!toggles.places) delete p.placesNote;
    // Nov 19, 2026, Viz.Bible Phase 2: unchecking the names
    // note drops it the same way, with its sources entry.
    if (!toggles.names) delete p.namesNote;
    // Nov 19, 2026, Viz.Bible Phase 3: unchecking the topics
    // note drops it the same way, with its sources entry.
    if (!toggles.topics) delete p.topicsNote;
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
        <JourneyStrip stage="review" member={isMember} labels={journeyLabels} />
        <h1>{pageTitle}</h1>
        <p>{t(appLanguage, "review.loadingDraft")}</p>
      </main>
    );
  }
  if (draftId && draftError) {
    return (
      <main className="fp-main">
        <JourneyStrip stage="review" member={isMember} labels={journeyLabels} />
        <h1>{pageTitle}</h1>
        <p><strong>{draftError}</strong></p>
        <p>{t(appLanguage, "review.draftBelongsOther")}</p>
      </main>
    );
  }
  if (!pack) {
    return (
      <main className="fp-main">
        <JourneyStrip stage="review" member={isMember} labels={journeyLabels} />
        <h1>{pageTitle}</h1>
        <p>{t(appLanguage, "review.nothingToReview")}</p>
        <p>{t(appLanguage, "review.goStartPrefix")} <a href="/input">{t(appLanguage, "journey.start")}</a> {t(appLanguage, "review.goStartSuffix")}</p>
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
  // Nov 21, 2026, v63: "1 word." vs "2 words." in the app language.
  const wc = (n) => (n === 1 ? tf(appLanguage, "review.wordCountOne", { n }) : tf(appLanguage, "review.wordCountMany", { n }));
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
      const first = plainScripture[0] || plainIssues[0] || t(appLanguage, "review.checkNotPassed");
      setLockError(tf(appLanguage, "review.notReadyLock", { first }));
      return;
    }
    const result = lockPack(filteredPack, store, packTranslation);
    // Nov 3, 2026, agent-test fix W3: a failed lock used to
    // return silently, leaving the pastor with no explanation.
    // A lock can still fail (a required field cleared, for
    // example), so the error now shows next to the button.
    if (!result.ok) { setLockError(result.errors?.join(" ") || t(appLanguage, "review.lockFailed")); return; }
    setLocked(result.pack);
    // Step 7: a locked pack saves itself to this pastor's library.
    try {
      const res = await fetch("/api/packs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: result.pack.id, title: result.pack.title, passage: result.pack.passage, status: "locked", lockHash: result.pack.lockHash, pack: result.pack }),
      });
      setSaved(res.ok ? t(appLanguage, "review.savedToLibrary") : t(appLanguage, "review.lockedNotSaved"));
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
          else setSaved(t(appLanguage, "review.savedPdfFailed"));
        } catch {
          setSaved(t(appLanguage, "review.savedPdfFailed"));
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
      setSaved(t(appLanguage, "review.lockedNotSavedShort"));
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
      const first = plainScripture[0] || plainIssues[0] || t(appLanguage, "review.checkNotPassed");
      setSaveError(tf(appLanguage, "review.notReadySave", { first }));
      return;
    }
    try {
      const res = await fetch("/api/packs/personal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: filteredPack }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setSaveError(data.error || t(appLanguage, "review.saveFailed")); return; }
      setSavedPersonal(data.entry);
      setSaved(t(appLanguage, "review.savedPersonalShort"));
      try {
        const pdfRes = await fetch("/api/packs/pdf", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: filteredPack.id }),
        });
        const pdfJson = await pdfRes.json().catch(() => ({}));
        if (pdfJson.ok) setPdfLink(pdfJson.pdf);
        else setSaved(t(appLanguage, "review.savedPersonalPdfFailed"));
      } catch {
        setSaved(t(appLanguage, "review.savedPersonalPdfFailed"));
      }
    } catch {
      setSaveError(t(appLanguage, "review.saveFailed"));
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
    if (!window.confirm(tf(appLanguage, "review.rejectConfirm", { name: submittedBy || t(appLanguage, "review.memberFallback") }))) return;
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
    setToggles({ days: {}, leader: true, song: true, classic: true, places: true, names: true, topics: true, coloring: true, coverNote: true });
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
      <p><strong>{t(appLanguage, "review.savedPersonalLine")}</strong></p>
      {saved && <p>{saved}</p>}
      {pdfLink && <p><a href={pdfLink}>{t(appLanguage, "review.downloadPdf")}</a></p>}
      <p><a href="/packs">{t(appLanguage, "review.viewStudies")}</a></p>
      <p><button onClick={onExportBridge}>{t(appLanguage, "review.sendToPastor")}</button> {t(appLanguage, "review.sendBridgeNote")}</p>
      <button onClick={() => setSavedPersonal(null)}>{t(appLanguage, "review.editAgain")}</button>
    </div>
  ) : (
    <div>
      <button onClick={onSavePersonal} className="fp-btn-green fp-btn-mobile-block" style={{ padding: "10px 18px", fontSize: 16 }}>
        {t(appLanguage, "review.savePersonal")}
      </button>
      {saveError && <p><strong>{saveError}</strong></p>}
      {!canSave && !saveError && <p>{t(appLanguage, "review.saveBlockedHint")}</p>}
      <p><button onClick={onExportBridge}>{t(appLanguage, "review.sendToPastor")}</button> {t(appLanguage, "review.sendBridgeNote")}</p>
    </div>
  );

  const approveArea = isMember ? memberApproveArea : locked ? (
    <div>
      <p><strong>{tf(appLanguage, "review.lockedLine", { name: locked.pastorName, church: locked.church })}</strong></p>
      <p>{t(appLanguage, "review.approvalCode")} <code>{locked.lockHash}</code></p>
      {saved && <p>{saved}</p>}
      {pdfLink && <p><a href={pdfLink}>{t(appLanguage, "review.downloadPdf")}</a></p>}
      <p><a href={`/pack/${packSlug(locked, locked.id)}`}>{t(appLanguage, "review.viewShare")}</a> | <a href="/packs">{t(appLanguage, "review.viewLibrary")}</a></p>
      <button onClick={onUnlock}>{t(appLanguage, "review.unlockButton")}</button>
    </div>
  ) : (
    <div>
      <button onClick={onLock} className="fp-btn-green fp-btn-mobile-block" style={{ padding: "10px 18px", fontSize: 16 }}>
        {t(appLanguage, "review.approve")}
      </button>
      {lockError && <p><strong>{lockError}</strong></p>}
      {!canLock && !lockError && <p>{t(appLanguage, "review.lockBlockedHint")}</p>}
    </div>
  );

  return (
    <main className="fp-main">
      <JourneyStrip stage={locked ? "share" : savedPersonal ? "save" : "review"} member={isMember} labels={journeyLabels} />
      <h1>{pageTitle}</h1>
      <p>{isMember ? t(appLanguage, "review.introMember") : t(appLanguage, "review.introPastor")}</p>
      {draftId && <p><strong>{t(appLanguage, "review.draftBanner")}</strong> {isMember ? t(appLanguage, "review.draftNoteMember") : t(appLanguage, "review.draftNotePastor")}</p>}
      {memberSubmitted && !isMember && (
        <p><strong>{tf(appLanguage, "review.sentBy", { name: submittedBy })}</strong> {t(appLanguage, "review.memberDraftIntro")} <button type="button" onClick={onRejectMemberDraft}>{t(appLanguage, "review.rejectDraft")}</button></p>
      )}

      <section className="fp-checks-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "review.checksHeading")}</h2>
        <p>{t(appLanguage, "review.checksIntro")}</p>
        <div className="fp-checks-bar" role="img" aria-label={tf(appLanguage, "review.checksCleared", { n: gatesPassed })}>
          <div className="fp-checks-fill" style={{ width: `${(gatesPassed / 2) * 100}%` }} />
        </div>
        <p><strong>{tf(appLanguage, "review.checksCleared", { n: gatesPassed })}</strong></p>
        <p className="fp-check-row"><strong>{t(appLanguage, "review.scriptureLabel")}</strong> <span className={scripture.ok ? "fp-check-ok" : "fp-check-need"}>{scripture.ok ? t(appLanguage, "review.scriptureOk") : t(appLanguage, "review.scriptureNeed")}</span></p>
        {!scripture.ok && <ul>{plainScripture.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <p className="fp-check-row"><strong>{t(appLanguage, "review.daysLabel")}</strong> <span className={quality.ok ? "fp-check-ok" : "fp-check-need"}>{quality.ok ? t(appLanguage, "review.daysOk") : t(appLanguage, "review.daysNeed")}</span></p>
        {!quality.ok && <ul>{plainIssues.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        {activeWarnings.length ? <div className="fp-gold-box"><p style={{ marginTop: 0 }}><strong>{t(appLanguage, "review.secondLook")}</strong></p><ul>{activeWarnings.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => acceptWarning(w)}>{t(appLanguage, "review.thisIsFine")}</button></li>)}</ul><p style={{ marginBottom: 0 }}>{t(appLanguage, "review.secondLookNote")}</p></div> : null}
        {activeDoctrinal.length ? <div className="fp-gold-box"><p style={{ marginTop: 0 }}><strong>{t(appLanguage, "review.doctrinalHeading")}</strong></p><p>{t(appLanguage, "review.doctrinalIntro")}</p><ul>{activeDoctrinal.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => acceptWarning(w)}>{t(appLanguage, "review.thisIsFine")}</button></li>)}</ul></div> : null}
        {acceptedDoctrinal.length ? <div><p><strong>{t(appLanguage, "review.doctrinalHeading")} {t(appLanguage, "review.checkedByYou")}</strong></p><ul>{acceptedDoctrinal.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => unacceptWarning(w)}>{t(appLanguage, "review.undo")}</button></li>)}</ul></div> : null}
        {acceptedShown.length ? <div><p><strong>{t(appLanguage, "review.checkedByYou")}</strong></p><ul>{acceptedShown.map((w, i) => <li key={i}>{w} <button type="button" disabled={ro} onClick={() => unacceptWarning(w)}>{t(appLanguage, "review.undo")}</button></li>)}</ul></div> : null}
        {hiddenWarningCount > 0 && <p>{hiddenWarningCount === 1 ? tf(appLanguage, "review.lengthNotesOne", { n: hiddenWarningCount }) : tf(appLanguage, "review.lengthNotesMany", { n: hiddenWarningCount })}</p>}
        <p><strong>{filteredPack.adultDevotionals.length === 1 ? tf(appLanguage, "review.packIncludesOne", { n: filteredPack.adultDevotionals.length, total: pack.adultDevotionals.length }) : tf(appLanguage, "review.packIncludesMany", { n: filteredPack.adultDevotionals.length, total: pack.adultDevotionals.length })}</strong></p>
        {approveArea}
        <p><button onClick={onReset}>{t(appLanguage, "review.resetButton")}</button></p>
      </section>

      {draftId ? <NarrationListen kind="draft" narrationId={draftId} packTitle={pack?.title ?? ""} language={lang} /> : null}

      <section className="fp-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "review.sectionsHeading")}</h2>
        <p>{t(appLanguage, "review.sectionsIntro")}</p>
        {pack.adultDevotionals.map((a) => (
          <p key={a.day}><label><input type="checkbox" checked={isDayOn(a.day)} disabled={ro} onChange={() => toggleDay(a.day)} /> {dayName(a.day)}: {a.title} ({fr(a.scripture.reference)})</label></p>
        ))}
        <p><label><input type="checkbox" checked={toggles.leader} disabled={ro} onChange={() => setToggles((t) => ({ ...t, leader: !t.leader }))} /> {t(appLanguage, "review.leaderToggle")}</label></p>
        <p><label><input type="checkbox" checked={toggles.song} disabled={ro} onChange={() => setToggles((t) => ({ ...t, song: !t.song }))} /> {t(appLanguage, "review.songToggle")}</label></p>
        {pack.classicDevotional && <p><label><input type="checkbox" checked={toggles.classic} disabled={ro} onChange={() => setToggles((t) => ({ ...t, classic: !t.classic }))} /> {t(appLanguage, "review.classicDevotional")} {pack.classicDevotional.title}{pack.classicDevotional.tradition_label ? ` (${pack.classicDevotional.tradition_label})` : ""}</label></p>}
        {pack.placesNote?.places?.length ? <p><label><input type="checkbox" checked={toggles.places} disabled={ro} onChange={() => setToggles((t) => ({ ...t, places: !t.places }))} /> {t(appLanguage, "review.placesToggle")} ({pack.placesNote.places.map((p) => p.name).join(", ")})</label></p> : null}
        {pack.namesNote?.names?.length ? <p><label><input type="checkbox" checked={toggles.names} disabled={ro} onChange={() => setToggles((t) => ({ ...t, names: !t.names }))} /> {t(appLanguage, "review.namesToggle")} ({pack.namesNote.names.map((n) => n.name).join(", ")})</label></p> : null}
        {pack.topicsNote?.verses?.length ? <p><label><input type="checkbox" checked={toggles.topics} disabled={ro} onChange={() => setToggles((t) => ({ ...t, topics: !t.topics }))} /> {t(appLanguage, "review.topicsToggle")} ({pack.topicsNote.topic})</label></p> : null}
        <p><label><input type="checkbox" checked={toggles.coloring} disabled={ro} onChange={() => setToggles((t) => ({ ...t, coloring: !t.coloring }))} /> {t(appLanguage, "review.coloringToggle")}</label></p>
        <p><label><input type="checkbox" checked={toggles.coverNote} disabled={ro} onChange={() => setToggles((t) => ({ ...t, coverNote: !t.coverNote }))} /> {t(appLanguage, "review.coverNoteToggle")}</label></p>
        <p><label><input type="checkbox" checked disabled /> {tf(appLanguage, "review.memoryAlways", { ref: fr(pack.memoryVerse.reference) })}</label></p>
      </section>

      {(filteredPack.phosVoices?.commentary?.length || filteredPack.phosVoices?.devotionals?.length || filteredPack.classicDevotional?.tradition_label) ? (
        <section className="fp-card">
          <h2 style={{ marginTop: 0 }}>{t(appLanguage, "review.voicesHeading")}</h2>
          <p>{t(appLanguage, "review.voicesIntro")}</p>
          {filteredPack.classicDevotional ? (
            <p><strong>{t(appLanguage, "review.classicDevotional")}</strong> {filteredPack.classicDevotional.workTitle || filteredPack.classicDevotional.title}{filteredPack.classicDevotional.tradition_label ? ` (${filteredPack.classicDevotional.tradition_label})` : ""}</p>
          ) : null}
          {filteredPack.phosVoices?.commentary?.length ? (
            <div>
              <p><strong>{t(appLanguage, "review.commentaryVoices")}</strong></p>
              <ul>
                {filteredPack.phosVoices.commentary.map((v) => (
                  <li key={v.source}>{v.title}{v.tradition_label ? ` (${v.tradition_label})` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {filteredPack.phosVoices?.devotionals?.length ? (
            <div>
              <p><strong>{t(appLanguage, "review.devotionalVoices")}</strong></p>
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
        <Field label={t(appLanguage, "review.packTitle")} value={pack.title} readOnly={ro} onChange={(v) => set((p) => { p.title = v; })} />
        <Field label={t(appLanguage, "review.passage")} value={pack.passage} readOnly={ro} onChange={(v) => set((p) => { p.passage = v; })} />
        <Field label={isMember ? t(appLanguage, "review.memberName") : t(appLanguage, "review.pastorName")} value={pack.pastorName} readOnly={ro} onChange={(v) => set((p) => { p.pastorName = v; if (isMember) p.memberName = v; })} />
        {!isMember && <Field label={t(appLanguage, "review.church")} value={pack.church} readOnly={ro} onChange={(v) => set((p) => { p.church = v; })} />}

        <h2>{t(appLanguage, "review.memoryVerseHeading")}</h2>
        <p>{fr(pack.memoryVerse.reference)}: {pack.memoryVerse.text}</p>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{t(appLanguage, "review.memoryVerseRef")}</span>
          <select disabled={ro} value={pack.memoryVerse.reference} onChange={(e) => set((p) => { p.memoryVerse = fillVerse(e.target.value, store, packTranslation); })}>
            {allowedRefs.map((r) => <option key={r} value={r}>{fr(r)}</option>)}
          </select>
        </label>

        <section className="fp-card">
          <h2 style={{ marginTop: 0 }}>{t(appLanguage, "review.coverHeading")}</h2>
          <p>{(pack.sermonSnapshot?.summary ?? "").trim() ? t(appLanguage, "review.coverIntroSermon") : t(appLanguage, "review.coverIntroNoSermon")}</p>
          {pack.sermonSnapshot ? (
            <div>
              <Field label={t(appLanguage, "review.sermonSummary")} multiline maxLength={320} value={pack.sermonSnapshot.summary} readOnly={ro} onChange={(v) => set((p) => { p.sermonSnapshot.summary = v; })} />
              <p>{wc(wordCount(pack.sermonSnapshot.summary))}</p>
              <Field label={t(appLanguage, "review.sermonQuote")} multiline maxLength={220} value={pack.sermonSnapshot.quote ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.sermonSnapshot.quote = stripQuoteMarks(v); })} />
              <p>{t(appLanguage, "review.quoteMarksNote")}</p>
              <p>{wc(wordCount(pack.sermonSnapshot.quote ?? ""))} {pack.sermonSnapshot.quote ? (quoteMatchesSermon ? t(appLanguage, "review.quoteMatches") : t(appLanguage, "review.quoteMismatch")) : t(appLanguage, "review.noQuote")}</p>
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
              <h3>{t(appLanguage, "review.ownNoteHeading")}</h3>
              <p>{t(appLanguage, "review.ownNoteIntro")}</p>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{tf(appLanguage, "review.noteVerseLabel", { example: lang === "es" ? "Santiago 1:4" : "James 1:4" })}</span>
                <input style={{ width: "100%", padding: 8, fontSize: 15, border: "1px solid #ccc", borderRadius: 6, background: ro ? "#eee" : "#fff" }} value={noteRef} readOnly={ro} onChange={(e) => setNoteRef(e.target.value)} onBlur={() => { if (noteRef.trim() && !ro) resolveNoteVerse(noteRef); }} />
              </label>
              {noteVerseStatus === "checking" ? <p>{t(appLanguage, "review.checkingVerse")}</p> : null}
              {noteVerseStatus === "found" && pack.pastorNote?.verse?.text ? <p>{fr(pack.pastorNote.verse.reference)}: &ldquo;{pack.pastorNote.verse.text}&rdquo;</p> : null}
              {noteVerseStatus === "not-found" ? <p>{t(appLanguage, "review.verseNotFound")}</p> : null}
              {noteVerseStatus === "unknown-book" ? <p>{tf(appLanguage, "review.bookNotFound", { example: lang === "es" ? "Santiago 1:4" : "James 1:4" })}</p> : null}
              <Field label={t(appLanguage, "review.yourWords")} multiline maxLength={300} value={pack.pastorNote?.note ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.pastorNote = { ...(p.pastorNote ?? { verse: { reference: "", translation: packTranslation, text: "" } }), note: v }; })} />
              <p>{wc(wordCount(pack.pastorNote?.note ?? ""))}</p>
            </>
          ) : null}
          <p><strong>{!toggles.coverNote ? t(appLanguage, "review.coverNoteUnchecked") : (pack.pastorNote?.verse?.text && (pack.pastorNote?.note ?? "").trim() ? t(appLanguage, "review.coverNoteOwn") : ((pack.sermonSnapshot?.summary ?? "").trim() ? t(appLanguage, "review.coverNoteSermon") : t(appLanguage, "review.coverNoteEmpty")))}</strong></p>
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
              <h2>{dayName(day)}{on ? "" : ` - ${t(appLanguage, "review.dayExcluded")}`}</h2>
              {(dayFlags.issues.length > 0 || dayFlags.warnings.length > 0) && (
                <div style={{ color: "darkred" }}>
                  <p><strong>{t(appLanguage, "review.needsLook")}</strong></p>
                  {dayFlags.issues.map((t, i) => (
                    <p key={`i${i}`}>{t} {/quotes its verse verbatim|cita su versículo palabra por palabra/.test(t) && (
                      <button type="button" disabled={ro || rewriteState[day]?.status === "running"} onClick={() => rewriteDayBody(day)}>
                        {rewriteState[day]?.status === "running" ? t(appLanguage, "review.rewriting") : t(appLanguage, "review.rewriteButton")}
                      </button>
                    )}</p>
                  ))}
                  {rewriteState[day]?.message && <p>{rewriteState[day].message}</p>}
                  {dayFlags.warnings.map((t, i) => <p key={`w${i}`}>{t} <button type="button" disabled={ro} onClick={() => acceptWarning(t)}>{t(appLanguage, "review.thisIsFine")}</button></p>)}
                </div>
              )}
              <Field label={t(appLanguage, "review.adultTitle")} value={a.title} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].title = v; })} />
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{t(appLanguage, "review.adultRef")}</span>
                <select disabled={ro} value={a.scripture.reference} onChange={(e) => set((p) => { p.adultDevotionals[i].scripture = fillVerse(e.target.value, store, packTranslation); })}>
                  {allowedRefs.map((r) => <option key={r} value={r}>{fr(r)}</option>)}
                </select>
              </label>
              <p>{t(appLanguage, "review.scriptureText")} &ldquo;{a.scripture.text}&rdquo;</p>
              <Field label={t(appLanguage, "review.dayAdult")} multiline value={a.body} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].body = v; })} />
              <Field label={t(appLanguage, "review.adultPrayer")} multiline value={a.prayer} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].prayer = v; })} />
              {day === lookAheadDay && (
                <Field label={t(appLanguage, "review.lookAhead")} multiline value={a.lookAhead ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.adultDevotionals[i].lookAhead = v; })} />
              )}
              <Field label={t(appLanguage, "review.kidTitle")} value={k.title} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].title = v; })} />
              <Field label={t(appLanguage, "review.kidRetelling")} multiline value={k.retelling} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].retelling = v; })} />
              <Field label={t(appLanguage, "review.kidActivity")} multiline value={k.activity} readOnly={ro} onChange={(v) => set((p) => { p.kidDevotionals[i].activity = v; })} />
            </section>
          );
        })}

        <h2>{t(appLanguage, "review.leaderHeading")}</h2>
        {(leaderFlags.issues.length > 0 || leaderFlags.warnings.length > 0) && (
          <div style={{ color: "darkred" }}>
            <p><strong>{t(appLanguage, "review.needsLook")}</strong></p>
            {leaderFlags.issues.map((t, i) => <p key={`i${i}`}>{t}</p>)}
            {leaderFlags.warnings.map((t, i) => <p key={`w${i}`}>{t} <button type="button" disabled={ro} onClick={() => acceptWarning(t)}>{t(appLanguage, "review.thisIsFine")}</button></p>)}
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
            {!qOn && <p><strong>{tf(appLanguage, "review.questionExcluded", { n: i + 1, day: qDay ? ` (${dayName(qDay)})` : "" })}</strong></p>}
            {/* Nov 4, 2026, readability (Mac test item 20):
            questions and notes used to be single-line fields
            that cut long text off mid-word. They are now
            multi-line, so the whole question and note read
            on the page. */}
            <Field label={tf(appLanguage, "review.questionLabel", { n: i + 1 })} multiline value={q.question} readOnly={ro} onChange={(v) => set((p) => { p.leaderQuestions[i].question = v; })} />
            <Field label={t(appLanguage, "review.leaderNoteLabel")} multiline value={q.leaderNote ?? ""} readOnly={ro} onChange={(v) => set((p) => { p.leaderQuestions[i].leaderNote = v; })} />
          </div>
          );
        })}

        {pack.chorus ? (
          <>
            <h2>{t(appLanguage, "review.chorusHeading")}</h2>
            <p>{t(appLanguage, "review.chorusNote")}</p>
            <Field label={t(appLanguage, "review.chorusTitle")} value={pack.chorus.title} readOnly={ro} onChange={(v) => set((p) => { p.chorus.title = v; })} />
            <Field label={t(appLanguage, "review.chordPro")} multiline value={pack.chorus.chordPro} readOnly={ro} onChange={(v) => set((p) => { p.chorus.chordPro = v; })} />
            <p>{pack.chorus.original ? t(appLanguage, "review.originalYes") : t(appLanguage, "review.originalNo")}</p>
          </>
        ) : null}

        {pack.hymnCandidates?.length ? (
          <section className="fp-card">
            <h2>{t(appLanguage, "review.hymnPickHeading")}</h2>
            <p>{pack.hymnCandidates.some((h) => h.related) ? t(appLanguage, "review.hymnNoMatch") : t(appLanguage, "review.hymnMatched")}</p>
            {pack.hymnCandidates.map((h) => (
              <p key={h.id}>
                <button type="button" disabled={ro} onClick={() => set((p) => { p.hymn = { ...h }; delete p.hymn.related; })}>
                  {pack.hymn?.id === h.id ? t(appLanguage, "review.chosen") : t(appLanguage, "review.use")}{h.title}{h.tune ? ` (${h.tune})` : ""}
                </button>
                {" "}{tf(appLanguage, "review.hymnWords", { author: h.author, years: h.authorYears, year: h.wordsYear })} {tf(appLanguage, "review.hymnMeter", { meter: h.meter })} {t(appLanguage, "review.publicDomain")}
              </p>
            ))}
            <p><button type="button" disabled={ro} onClick={() => set((p) => { delete p.hymn; })}>{t(appLanguage, "review.noSongButton")}</button></p>
            {pack.hymn ? <p>{tf(appLanguage, "review.nowChosenSong", { title: `${pack.hymn.title}${pack.hymn.tune ? ` (${pack.hymn.tune})` : ""}` })}</p> : <p>{t(appLanguage, "review.nowChosenNone")}</p>}
          </section>
        ) : null}
        {pack.hymn && !pack.hymnCandidates?.length ? (
          <section className="fp-card">
            <h2>{t(appLanguage, "review.hymnHeading")}</h2>
            <p>{pack.hymn.title}{pack.hymn.tune ? ` (${pack.hymn.tune})` : ""}. {tf(appLanguage, "review.hymnWords", { author: pack.hymn.author, years: pack.hymn.authorYears, year: pack.hymn.wordsYear })} {t(appLanguage, "review.publicDomain")}</p>
            <p><button type="button" disabled={ro} onClick={() => set((p) => { delete p.hymn; })}>{t(appLanguage, "review.noSongButton")}</button></p>
          </section>
        ) : null}

        {!pack.hymn && !pack.chorus && !pack.hymnCandidates?.length ? <p>{t(appLanguage, "review.noHymnFits")}</p> : null}

        <h2>{t(appLanguage, "review.coloringHeading")}</h2>
        <Field label={t(appLanguage, "review.coloringTitle")} value={pack.coloring.title} readOnly={ro} onChange={(v) => set((p) => { p.coloring.title = v; })} />
        <Field label={t(appLanguage, "review.coloringDesc")} multiline value={pack.coloring.description} readOnly={ro} onChange={(v) => set((p) => { p.coloring.description = v; })} />
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
              <p>{tf(appLanguage, "review.templateLabel", { id: chosen, caption: tpl.caption })}</p>
              <img src={`/coloring/${tpl.file}`} alt={tpl.alt} width={400} style={{ border: "1px solid #ccc", background: "#fff" }} />
              <p>{t(appLanguage, "review.coloringPickIntro")}</p>
              {Object.entries(COLORING_TEMPLATES).map(([id, t]) => (
                <p key={id}>
                  <button type="button" disabled={ro} onClick={() => set((p) => { p.coloring.svgTemplateId = id; p.coloring.description = t.caption; })}>
                    {id === chosen ? t(appLanguage, "review.chosen") : t(appLanguage, "review.use")}{t.caption}
                  </button>
                </p>
              ))}
            </div>
          );
        })()}
      </section>

      <section className="fp-checks-card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>{isMember ? t(appLanguage, "review.readySave") : t(appLanguage, "review.readyLock")}</h2>
        {approveArea}
      </section>
    </main>
  );
}
