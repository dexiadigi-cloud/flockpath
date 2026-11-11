import { z } from "zod";
import { formatRef } from "./refs.mjs";

// Flockpath quality gate, built after Step 4 showed the 1.7B model
// reusing GEN 1:1 on Friday.
//
// Principle: the pastor should double-check, not fix. So reuse is
// caught by code, not by eye, and repaired by the system before
// the pack is ever shown as ready.
//
// This gate is deliberately deterministic, not another LLM judge:
// duplicate references, duplicate titles, duplicate openings, and
// high word overlap are measurable. A judge would just add a
// second model that can make the same mistake.
//
// It is separate from lockPack() on purpose. lockPack() answers
// "is every Scripture quote exact?" This answers "is this pack
// actually five different days, or one day said five times?"
// A pack needs both to be shown as ready.

const STOP = new Set([
  "the", "and", "of", "to", "a", "in", "is", "it", "for", "on", "that",
  "god", "we", "you", "our", "us", "he", "his", "with", "was", "are",
  "this", "from", "by", "as", "at", "be", "or", "an",
]);

export function words(text) {
  return new Set(
    (text ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w))
  );
}

export function jaccard(a, b) {
  const A = words(a), B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export function firstSentence(text) {
  const m = (text ?? "").trim().match(/^[^.!?]+[.!?]?/);
  return (m ? m[0] : "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function duplicates(values) {
  const seen = new Map();
  const dupes = [];
  for (const v of values) {
    const k = v.toLowerCase().trim();
    if (seen.has(k)) dupes.push(v);
    else seen.set(k, true);
  }
  return dupes;
}

export function checkQuality(draft) {
  const issues = [];
  // Nov 1, 2026, quality flags: warnings are not blocks. A
  // warning says "read this carefully", an issue says "do not
  // lock this as it stands". Warnings never make ok false, so
  // a pastor can lock a flagged pack after reading it, or
  // uncheck the flagged section and lock the rest.
  const warnings = [];
  const adult = draft.adultDevotionals ?? [];
  const kid = draft.kidDevotionals ?? [];

  // Nov 3, 2026, agent-test improvement I1: defense in depth
  // for the one-day rule. The UI toggle guard and the lock
  // schema already prevent a day-less lock, but the gate
  // itself said nothing. Now the gate message says so too.
  if (adult.length === 0) issues.push("At least one day must stay in the pack.");

  const refDupes = duplicates(adult.map((d) => d.scripture?.reference ?? ""));
  if (refDupes.length) issues.push(`Repeated Scripture reference: ${refDupes.join(", ")} - each day must use a different verse.`);

  const titleDupes = duplicates(adult.map((d) => d.title ?? ""));
  if (titleDupes.length) issues.push(`Repeated adult title: ${titleDupes.join(", ")}`);

  // Step 7.5 Phase B, found by the crossref test: kid titles can
  // duplicate each other (Thursday and Friday both "Jesus' Big
  // Heart" in the John crossref pack) and the old gate missed it,
  // because it only checked kid titles against adult titles.
  const kidTitleDupes = duplicates(kid.map((d) => d.title ?? ""));
  if (kidTitleDupes.length) issues.push(`Repeated kid title: ${kidTitleDupes.join(", ")} - give each kid day its own title.`);

  const openingDupes = duplicates(adult.map((d) => firstSentence(d.body ?? "")));
  if (openingDupes.length) issues.push(`Repeated opening sentence across adult devotionals: "${openingDupes.join('", "')}"`);

  const prayerDupes = duplicates(adult.map((d) => d.prayer ?? ""));
  if (prayerDupes.length) issues.push(`Repeated prayer text across days.`);

  for (let i = 0; i < adult.length; i++) {
    for (let j = i + 1; j < adult.length; j++) {
      const s = jaccard(adult[i].body, adult[j].body);
      if (s > 0.55) issues.push(`Adult ${adult[i].day} and ${adult[j].day} bodies overlap too much (similarity ${s.toFixed(2)}). Rewrite one with a different angle.`);
    }
  }

  const kidDupes = duplicates(kid.map((d) => d.retelling ?? ""));
  if (kidDupes.length) issues.push(`Repeated kid retelling text.`);
  for (let i = 0; i < kid.length; i++) {
    for (let j = i + 1; j < kid.length; j++) {
      const s = jaccard(kid[i].retelling, kid[j].retelling);
      if (s > 0.55) issues.push(`Kid ${kid[i].day} and ${kid[j].day} retellings overlap too much (similarity ${s.toFixed(2)}).`);
    }
  }

  // A kid retelling that is just the adult body copied is not a
  // retelling for ages 6-10, it is a paste.
  for (let i = 0; i < Math.min(adult.length, kid.length); i++) {
    const s = jaccard(adult[i].body, kid[i].retelling);
    if (s > 0.8) issues.push(`Kid ${kid[i].day} retelling is almost identical to the adult body. Rewrite it in plain words for ages 6-10.`);
  }

  const questionDupes = duplicates((draft.leaderQuestions ?? []).map((q) => q.question ?? ""));
  if (questionDupes.length) issues.push(`Repeated leader question.`);

  // 2026-10-30, Phase E finding with the final 4B model: it
  // returns 3 to 5 leader questions when asked for 5, not
  // always 5. A short leader page is not broken, but it is
  // not the promised page, so the gate flags it for repair
  // instead of silently locking a short page.
  // Nov 1, 2026, toggles: 0 questions means the leader page
  // was intentionally unchecked, not a short page. Only a
  // present-but-short list is flagged.
  if ((draft.leaderQuestions ?? []).length > 0 && (draft.leaderQuestions ?? []).length < 5) {
    issues.push(`Only ${(draft.leaderQuestions ?? []).length} leader questions, expected 5. Repair the questions section, do not lock a short leader page.`);
  }

  // Step 7.5 Phase A, expanded checks, from the critique:
  // 1. Chorus lyrics: chords alone are not a song. Strip [chords]
  //    and require real words on at least two lines.
  if (draft.chorus) {
    const lyricLines = (draft.chorus.chordPro ?? "").split("\n").map((line) =>
      line.replace(/\[[^\]]*\]/g, " ").replace(/[^a-zA-Z\s']/g, " ").trim()
    ).filter((line) => line.split(/\s+/).filter(Boolean).length >= 2);
    if (lyricLines.length < 2) issues.push(`Chorus has no lyrics, only chords. A chorus must have words families can sing.`);
  }

  // 2. Kid titles must differ from adult titles, same day and
  //    across the pack. Psalm 23 duplicated adult titles on
  //    Wednesday, Thursday, and Friday, and the old gate missed it.
  const adultTitles = new Set(adult.map((d) => (d.title ?? "").toLowerCase().trim()));
  for (const k of kid) {
    if (adultTitles.has((k.title ?? "").toLowerCase().trim())) {
      issues.push(`Kid title duplicates an adult title: "${k.title}". Give the kid version its own title.`);
    }
  }

  // 3. Leader question diversity: no more than one question may
  //    start with the same four words (e.g. "What does it mean").
  const openings = {};
  for (const q of draft.leaderQuestions ?? []) {
    const open = (q.question ?? "").toLowerCase().split(/\s+/).slice(0, 4).join(" ");
    openings[open] = (openings[open] ?? 0) + 1;
  }
  for (const [open, count] of Object.entries(openings)) {
    if (count > 1) issues.push(`Leader questions repeat the same opening ${count} times: "${open}". Vary the questions.`);
  }

  // Nov 1, 2026, quality flags, from real model slips:
  // 4. Kid forbidden words: "magic" slipped into kid titles
  //    under three different models, so it is now a block, not
  //    a note. The pastor can edit the title or uncheck that
  //    day; the gate does not silently pass it.
  const FORBIDDEN_KID = ["magic", "magical", "spell", "witch", "fairy"];
  for (const k of kid) {
    const text = `${k.title ?? ""} ${k.retelling ?? ""}`.toLowerCase();
    const hit = FORBIDDEN_KID.find((w) => new RegExp(`\\b${w}\\b`).test(text));
    if (hit) issues.push(`Kid ${k.day} uses the word "${hit}", which does not belong in a Bible retelling for ages 6-10. Edit it or uncheck that day.`);
  }

  // 5. Adult body quoting the verse verbatim: the prompt says
  //    do not quote, but a model still did (Psalm 23 Thursday).
  //    Any 8 consecutive words from the verse text, in order,
  //    inside the body is a quote, not a paraphrase.
  function normWords(s) {
    return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  }
  for (const a of adult) {
    const verseWords = normWords(a.scripture?.text ?? "");
    const bodyWords = normWords(a.body ?? "");
    let quoted = false;
    for (let i = 0; i + 8 <= verseWords.length && !quoted; i++) {
      const chunk = verseWords.slice(i, i + 8).join(" ");
      if (bodyWords.join(" ").includes(chunk)) quoted = true;
    }
    if (quoted) issues.push(`Adult ${a.day} quotes its verse verbatim in the body. The body should be about the verse, in your own words, not a quote of it.`);
    const sentences = (a.body ?? "").split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length < 2) issues.push(`Adult ${a.day} body is under two sentences. A devotional day needs at least two sentences.`);
  }

  // 6. Leader question citing a verse outside the plan: a
  //    full reference in a question must be one of the pack's
  //    verses, or the memory verse, otherwise the question
  //    points families to a verse they were not given.
  const planRefs = new Set([draft.memoryVerse?.reference, ...adult.map((d) => d.scripture?.reference ?? "")]);
  for (const q of draft.leaderQuestions ?? []) {
    const cited = (q.question ?? "").match(/\b[A-Z][A-Z0-9]+ \d+:\d+\b/g) ?? [];
    for (const ref of cited) {
      if (!planRefs.has(ref)) issues.push(`Leader question cites ${ref}, which is not one of this pack's verses. Edit the question or uncheck the leader page.`);
    }
  }

  // 7. Negation attention, warning only: a verse that turns
  //    on didn't, not, or never is where a model once flipped
  //    the meaning (Romans 8:32). The gate cannot check
  //    meaning, so it directs the pastor's eyes there instead
  //    of pretending it did.
  for (const a of adult) {
    const verse = (a.scripture?.text ?? "").toLowerCase();
    if (/\b(didn'?t|doesn'?t|not|never|no one|nothing)\b/.test(verse)) {
      warnings.push(`${a.day} turns on a negation (${a.scripture?.reference}). Read that day's body carefully: check it does not flip what the verse actually says.`);
    }
    if (/\bmeans which\b/.test((a.body ?? "").toLowerCase())) {
      warnings.push(`${a.day} body contains a lexicon fragment ("means which?"). Read it and edit it if it reads awkwardly.`);
    }
  }

  // 7b. Nov 5, 2026, round-2, widened round-3 to the
  // opening two sentences, widened v25 to the WHOLE
  // retelling: a kid retelling that quotes the day verse,
  // nearly word for word, anywhere in it, strains the
  // retelling label (retellings are never Scripture, so a
  // verse inside one reads like a quote). Warning only,
  // never a block. Same 8-word window technique as the
  // adult verbatim issue, and the same scope as the v25
  // generation repair, so the backstop and the repair agree
  // on what counts. Round-3 proof: the Nov 4 James
  // speed-run pack's Thursday retelling quotes the verse
  // in its SECOND sentence; its Friday retelling quotes a
  // verse clause in its THIRD sentence, which the
  // opening-two-sentences scope missed. Wording is for a
  // pastor via the review page's plainWarning mapping.
  for (let i = 0; i < adult.length; i++) {
    const a = adult[i], k = kid[i];
    if (!a || !k) continue;
    const verseWords = normWords(a.scripture?.text ?? "");
    const retellingWords = normWords(k.retelling ?? "");
    if (!verseWords.length || !retellingWords.length) continue;
    const retellingStr = retellingWords.join(" ");
    let quotesVerse = false;
    if (verseWords.length < 8) {
      quotesVerse = retellingStr.includes(verseWords.join(" "));
    } else {
      for (let j = 0; j + 8 <= verseWords.length && !quotesVerse; j++) {
        if (retellingStr.includes(verseWords.slice(j, j + 8).join(" "))) quotesVerse = true;
      }
    }
    if (quotesVerse) warnings.push(`Kid ${a.day}: retelling quotes the verse itself.`);
  }

  // 8. Nov 1, 2026, v17 stop-the-loop flags, from real v16
  //    model slips, wired into the review screen so a
  //    pastor sees them, not just a test log. Length,
  //    overlap, weekday, and God-plus-work-verb are
  //    warnings, not blocks, because they are judgement
  //    or soft targets a pastor can edit in seconds.
  //    A Jesus or Christ insertion in a kid section
  //    whose verse does not name Jesus or Christ is a
  //    WARNING, never a block (Nov 5, 2026, Jeremiah's
  //    call, option B, round-5). The old block fired
  //    whenever the verse did not say "Son", which is
  //    exactly the parables and the Beatitudes, where
  //    Jesus is speaking and the verse cannot name its
  //    own speaker; the pastor lost three whole days to
  //    it in the Nov 5 Powers of God's Word test. The
  //    pastor reads the warning and accepts it or edits
  //    it, in review; no day is ever lost to this check.
  //    Title fallback to a verse reference is a warning,
  //    boring but correct.
  const OVERLAP_STOP = new Set("a an the and or of to in on for with by is are was were be been it its this that from as at".split(" "));
  function contentWords(s) {
    return new Set((s ?? "").toLowerCase().replace(/'s\b/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !OVERLAP_STOP.has(w)));
  }
  function overlapFraction(text, verse) {
    const t = contentWords(text), v = contentWords(verse);
    if (t.size === 0) return 0;
    let shared = 0;
    for (const w of t) if (v.has(w)) shared++;
    return shared / t.size;
  }
  const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const WORK_VERBS = ["smiled", "laughed", "cried", "checked", "inspected", "surveyed", "fixed", "corrected", "tested", "graded", "worried", "forgot", "rested", "slept"];
  function countWords(s) { return (s ?? "").split(/\s+/).filter(Boolean).length; }
  for (const a of adult) {
    const bw = countWords(a.body), pw = countWords(a.prayer);
    if (bw && (bw < 160 || bw > 250)) warnings.push(`Adult ${a.day}: body ${bw} words, outside 160-250. Edit or accept it before locking.`);
    if (pw && (pw < 30 || pw > 40)) warnings.push(`Adult ${a.day}: prayer ${pw} words, outside 30-40. Edit or accept it before locking.`);
    // v27, Nov 5, 2026, Enemies pack review: Thursday's
    // prayer was an instruction ("We must leave our gifts
    // at the altar...") not an address to God. A prayer
    // must contain a petition or an address (we pray, we
    // ask, help us, Lord, Father, Jesus, may you, grant,
    // give us, bless), not just a mention of God, so a
    // statement about God does not pass as a prayer.
    // Warning only, because a pastor may write a prayer
    // in another form.
    // v30, Nov 5, 2026: the v27 list passed a bare mention
    // of "jesus", "lord", "father", or "christ", so "We
    // trust that Jesus lives forever" and "We lift our
    // eyes as we wait for Jesus to return" passed, even
    // though both talk ABOUT God in third person and never
    // address Him. A bare noun is a mention, not an
    // address. An address is a vocative (Lord, / Father, /
    // Jesus, / God, / O Lord / O God / Dear Lord / Heavenly
    // Father) or a second-person petition (we pray, we ask,
    // help us, give us, grant, lead us, bless, fill us,
    // guide us, teach us, show us, thank you, thank thee,
    // hear us, be with us, may you, may we). A real prayer
    // also closes with Amen.
    const PRAYER_VOCATIVE = ["lord,", "father,", "jesus,", "god,", "o lord", "o god", "dear lord", "dear father", "heavenly father", "lord jesus", "dear god"];
    const PRAYER_PETITION = ["we pray", "we ask", "help us", "give us", "grant us", "lead us", "bless us", "bless", "fill us", "guide us", "teach us", "show us", "thank you", "thank thee", "thank god", "praise you", "praise god", "praise jesus", "hear us", "be with us", "may you", "may we"];
    const pText = (a.prayer ?? "").toLowerCase();
    // Word-boundary matching, not substring. A bare
    // substring "grant" matches "granting" ("granting us
    // a permanent priesthood" talks about Jesus, it does
    // not ask Him), and "bless" matches "blessed". The
    // trailing check is a negative lookahead for a
    // lowercase letter, not \b, because a phrase ending
    // in a comma ("Lord,") has no word boundary after it.
    const prayerAddresses = [...PRAYER_VOCATIVE, ...PRAYER_PETITION].some((phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(pText));
    if (pw && !prayerAddresses) warnings.push(`Adult ${a.day}: prayer does not address God. It reads like a statement about Him, not a prayer to Him. Rewrite it so it speaks to God by name before locking.`);
    if (pw && !(a.prayer ?? "").trim().replace(/[.!?]+$/, "").trim().toLowerCase().endsWith("amen")) warnings.push(`Adult ${a.day}: prayer does not end with Amen. Close it with 'In Jesus' name, Amen.' before locking.`);
    // v31, Nov 5, 2026: Jeremiah's P.A.T.H. method, which
    // mirrors the Lord's Prayer and fits the app's name
    // (Flockpath). A short prayer has one clause for each
    // letter: Praise (address God by name and praise His
    // greatness), Apologize (admit where we fail and ask
    // His forgiveness), Thanks (thank Him for what He has
    // done or provided), Help (ask Him for practical help
    // to live the verse out). The warning names the parts
    // that are missing, so the pastor sees exactly what
    // to add. Warning only, because a pastor may write a
    // prayer in another form.
    if (pw) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hasWord = (w) => new RegExp(`\\b${esc(w)}(?![a-z])`).test(pText);
      const PRAYER_PRAISE_WORDS = ["holy", "praise", "glory", "majesty", "worthy", "almighty", "great", "hallowed", "magnificent", "wonderful", "righteous", "faithful"];
      const PRAYER_HELP = ["help us", "give us", "lead us", "guide us", "strengthen", "protect", "grant us", "show us", "teach us", "fill us", "bless us", "keep us", "deliver us", "be with us", "hear us"];
      const missingPath = [];
      if (!PRAYER_VOCATIVE.some((v) => new RegExp(`\\b${esc(v)}(?![a-z])`).test(pText)) && !PRAYER_PRAISE_WORDS.some((w) => hasWord(w))) missingPath.push("Praise");
      // Apologize means asking God to forgive US, or
      // admitting our failure. A bare "forgive" or
      // "forgiveness" does not count: "the path of
      // forgiveness" is a noun about the verse, and "help
      // us forgive our hurtful members" is forgiving
      // others, not apologizing for ourselves.
      const PRAYER_APOLOGIZE = ["forgive us", "forgive me", "forgive our sins", "forgive our failures", "forgive our doubts", "sorry", "we have failed", "we fail", "we sinned", "we have sinned", "we turned away", "we have turned away"];
      if (!PRAYER_APOLOGIZE.some((a) => new RegExp(`\\b${esc(a)}(?![a-z])`).test(pText))) missingPath.push("Apologize");
      // v32: "thank you" / "thank thee" / "thank god" /
      // "thankful" / "thanksgiving". A bare "thanks"
      // does NOT count: "Thanks for the Cross" is the
      // label echo (Cross of Jesus 2), not a natural
      // prayer. The prompt tells the model to say
      // "Thank You for...".
      const PRAYER_THANKS = ["thank you", "thank thee", "thank god", "thankful", "thanksgiving"];
      if (!PRAYER_THANKS.some((t) => new RegExp(`\\b${esc(t)}(?![a-z])`).test(pText))) missingPath.push("Thanks");
      if (!PRAYER_HELP.some((h) => new RegExp(`\\b${esc(h)}(?![a-z])`).test(pText))) missingPath.push("Help");
      if (missingPath.length > 0) warnings.push(`Adult ${a.day}: prayer is missing P.A.T.H. part${missingPath.length > 1 ? "s" : ""}: ${missingPath.join(", ")}. A short prayer follows P.A.T.H. - Praise, Apologize, Thanks, Help - closing with Amen. Rewrite it before locking.`);
      // v32: the word "Apologize" itself is never natural
      // prayer language (Cross of Jesus 2: "Apologize, we
      // fail..." echoed the label even though "we fail" is
      // in the part list, so the part check passed it). A
      // person says "Forgive us", not "Apologize".
      if (/\bapologize\b/i.test(pText)) warnings.push(`Adult ${a.day}: prayer uses the label "Apologize" instead of asking forgiveness. Say "Forgive us for..." instead. Rewrite it before locking.`);
    }
    // Nov 5, 2026, round-3: compare in display form, so
    // a title the review screen already converted ("James
    // 1:4") still matches its code reference ("JAS 1:4").
    if (formatRef((a.title ?? "").trim()) === formatRef((a.scripture?.reference ?? "").trim())) warnings.push(`Adult ${a.day}: title is the verse reference, not a title. Give it a title before locking.`);
    // v17 correction, Nov 1: adult Thu survey language
    // persisted through v16 and v17, and the kid-only
    // God-plus-work-verb check missed it. Same check
    // for adult bodies, warning only, because the
    // verse may legitimately use a work verb.
    const verseText = a.scripture?.text ?? "";
    const agv = WORK_VERBS.find((v) => new RegExp(`\\bgod\\b[^.!?]*\\b${v}\\b`, "i").test(a.body ?? "") && !new RegExp(`\\b${v}\\b`, "i").test(verseText));
    if (agv) warnings.push(`Adult ${a.day}: body says God ${agv}, a human-work verb not in the verse. Read it carefully for theological loading.`);
    // v18: adult Son, Jesus, Christ warning, not a block,
    // because an adult devotional may legitimately
    // connect a passage to Christ, but for Genesis 1
    // v17 Wed said humans are chosen vessel for the
    // Son of God, which the verse does not say, so
    // the pastor must see it in review, not lock blind.
    const aText = `${a.body ?? ""} ${a.prayer ?? ""}`.toLowerCase();
    // v26, Nov 5, 2026, Jeremiah's call: Jesus is also
    // the Son of Man, so a verse that says "Son of Man"
    // names him, and a body that says it is not an
    // insertion. The Nov 5 salvation pack warned on
    // Luke 19:10 ("the Son of Man came to seek and to
    // save the lost") because the check did not know
    // the title. Son of Man counts on both sides now.
    if ((/\bjesus\b|\bchrist\b|\bson of god\b|\bson of man\b/.test(aText)) && !/\bjesus\b|\bchrist\b|\bson of god\b|\bson of man\b/.test(verseText.toLowerCase())) {
      warnings.push(`Adult ${a.day}: body names Jesus, Christ, Son of God, or Son of Man, but its verse does not. Read it carefully, a New Testament connection may be intentional, or an insertion to edit.`);
    }
    // v29, Nov 5, 2026, Golden Thread 3 review: Thursday's
    // application (a woodworking metaphor for Revelation
    // 22:1-5) and Friday's (weekend planning for Acts
    // 1:9-11) did not apply their verses at all. The adult
    // body is four paragraphs joined by blank lines, and
    // the third is the application (bodyToday). If it
    // shares zero content words with its verse, it cannot
    // be applying that verse. Warning only, because the
    // generation-time repair already retries it, and a
    // pastor may write an application in another form.
    // If the body has fewer than three paragraphs, skip
    // the check rather than warning on a malformed body.
    const bodyParts = (a.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (bodyParts.length >= 3 && verseText) {
      // The anchor stopwords exclude pronouns and function
      // words (they, their, them, down, than, when), which
      // appear in almost any verse and any paragraph by
      // chance. With only the base stopwords, the off-rails
      // Thursday and Friday applications scored 3, barely
      // below Monday at 4. With this set they score 0 and
      // Monday, Tuesday, Wednesday score 2, 5, 6.
      const ANCHOR_STOP = new Set([...OVERLAP_STOP, "they", "their", "them", "we", "us", "our", "you", "your", "he", "she", "his", "her", "it", "its", "this", "that", "these", "those", "who", "whom", "whose", "what", "when", "where", "why", "how", "than", "then", "just", "also", "now", "here", "there", "down", "up", "out", "over", "under", "again", "once", "into", "about", "after", "before", "between", "through", "during", "above", "below", "from", "with", "without", "within", "upon", "all", "any", "some", "no", "not", "only", "own", "same", "so", "too", "very", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "do", "does", "did", "have", "has", "had", "am"]);
      const anchorWords = (s) => new Set((s ?? "").toLowerCase().replace(/'s\b/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !ANCHOR_STOP.has(w)));
      const appWords = anchorWords(bodyParts[2]);
      const verseWords = anchorWords(verseText);
      let shared = 0;
      for (const w of appWords) if (verseWords.has(w)) shared++;
      if (shared === 0) warnings.push(`Adult ${a.day}: the application paragraph does not use any word from its verse. It may not connect to the passage. Rewrite it around the verse's own images before locking.`);
    }
  }
  for (const k of kid) {
    const a = adult.find((d) => d.day === k.day) ?? adult[kid.indexOf(k)];
    const verse = a?.scripture?.text ?? "";
    const rw = countWords(k.retelling);
    if (rw && (rw < 80 || rw > 120)) warnings.push(`Kid ${k.day}: retelling ${rw} words, outside 80-120. Edit or accept it before locking.`);
    if (formatRef((k.title ?? "").trim()) === formatRef((a?.scripture?.reference ?? "").trim())) warnings.push(`Kid ${k.day}: title is the verse reference, not a title. Give it a title before locking.`);
    const wd = WEEKDAYS.find((d) => new RegExp(`\\b${d}\\b`, "i").test(k.retelling ?? ""));
    if (wd) warnings.push(`Kid ${k.day}: retelling contains weekday "${wd}", which can conflate weekday with creation day. Read it carefully.`);
    if (verse && overlapFraction(k.retelling, verse) < 0.25) warnings.push(`Kid ${k.day}: retelling verse overlap ${overlapFraction(k.retelling, verse).toFixed(2)}, under 0.25. Check it does not import content from another verse.`);
    const gv = WORK_VERBS.find((v) => new RegExp(`\\bgod\\b[^.!?]*\\b${v}\\b`, "i").test(k.retelling ?? "") && !new RegExp(`\\b${v}\\b`, "i").test(verse));
    if (gv) warnings.push(`Kid ${k.day}: retelling says God ${gv}, a human-work verb not in the verse. Read it carefully for theological loading.`);
    // v19: within-retelling repetition, Wed v18 repeated
    // the image sentence 4 times to reach length. Same
    // sentence more than once, 4 words or more, is a warning.
    const _seen = new Set();
    let _dup = false;
    for (const _s of String(k.retelling ?? "").split(/[.!?]/)) {
      const _n = _s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      if (_n.split(" ").filter(Boolean).length >= 4) {
        if (_seen.has(_n)) { _dup = true; break; }
        _seen.add(_n);
      }
    }
    if (_dup) warnings.push(`Kid ${k.day}: retelling repeats a sentence. Edit or accept it before locking.`);
    // v22: draw-God activity warning, not a block.
    // V20 Wed activity was draw God and yourself,
    // v21 Wed activity was draw God's face, second
    // pack in a row for GEN 1:27, and no gate warning
    // existed, so a pastor could lock blind. Corrected
    // same day: God must be the DRAWN object, not
    // just a word anywhere, or v21 Mon, draw sky and
    // earth, write what God made first, falsely flags.
    // Pattern: draw verb, optional article, picture,
    // of, then god, God's counts, sketch counts,
    // paint does not, activity only, not retelling.
    const _actNorm = String(k.activity ?? "").toLowerCase().replace(/'s\b/g, "").replace(/[^a-z0-9\s]/g, " ");
    if (/\b(draw|drawing|sketch|sketching)\b\s+((a|the|an)\s+)?(picture\s+)?(of\s+)?god\b/.test(_actNorm)) warnings.push(`Kid ${k.day}: activity asks children to draw God. Many churches avoid depicting God. Review or change it before locking.`);
    const kidText = `${k.title ?? ""} ${k.retelling ?? ""}`.toLowerCase();
    // v26, Nov 5, 2026: "Son of Man" on the verse side
    // counts as naming Jesus, same as the adult gate.
    // A verse that says the Son of Man came is Jesus
    // naming himself, so no warning fires on it. The
    // bare "Son" case below only runs when the verse
    // says Son without "of Man".
    if ((/\bjesus\b/.test(kidText) || /\bchrist\b/.test(kidText)) && !/\bjesus\b|\bchrist\b|\bson of man\b/.test(verse.toLowerCase())) {
      // Nov 5, 2026, Jeremiah's call, option B, round-5:
      // warning everywhere, never a block. The Nov 1
      // rule blocked whenever the verse did not say
      // "Son", which fires on the parables and the
      // Beatitudes, where Jesus is speaking and the verse
      // cannot name its own speaker. The Son case keeps
      // its own wording, because there the connection is
      // explicit; every other case gets the general
      // wording. Either way the pastor reads it and
      // accepts it or edits it in review.
      if (/\bson\b/.test(verse.toLowerCase())) {
        warnings.push(`Kid ${k.day} names Jesus, but its verse says Son, not Jesus by name. In a New Testament passage the Son is Jesus, so read it and accept it if that connection is intended.`);
      } else {
        warnings.push(`Kid ${k.day} names Jesus or Christ, but its verse does not. Read it carefully, the name may belong there or be an added connection.`);
      }
    }
  }
  (draft.leaderQuestions ?? []).forEach((q, i) => {
    // Nov 2, 2026: the trailing "(Read <verse>.)" directive
    // is code-appended, not model prose, so it does not
    // count toward the 40-70 word note band. Nov 5, 2026,
    // round-3: the review screen converts it to full book
    // names on load ("(Read James 1:4.)"), so the strip
    // accepts any text after Read, in either form.
    const noteForCount = String(q.leaderNote ?? "").replace(/\s*\(?Read [^)]+\)?\s*$/, "");
    const nw = countWords(noteForCount);
    if (nw && (nw < 40 || nw > 70)) warnings.push(`Leader Q${i + 1}: note ${nw} words, outside 40-70. Edit or accept it before locking.`);
    if (i >= 3 && !/this week|will you|how can you|what will you|plan/i.test(q.question ?? "")) warnings.push(`Leader Q${i + 1}: application question lacks action wording. Check it asks what to do this week.`);
  });
  if (draft.chorus) {
    const lines = (draft.chorus.chordPro ?? "").split("\n").filter((l) => l.trim());
    if (lines.length > 0 && lines.length < 4) warnings.push(`Chorus: ${lines.length} lines, under 4. Edit or accept it before locking.`);
  }

  return { ok: issues.length === 0, issues, warnings };
}

// Deterministic day plan: the system assigns one distinct verse
// and one distinct angle per day, before the model writes a word.
// The model then cannot reuse a verse by accident, because reuse
// would mean disobeying an explicit per-day assignment, and
// checkQuality() would catch it anyway. This is the strongest
// steering in the whole system, and it costs no model quality.
export function assignDays(references, angles) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  if (references.length < 5) throw new Error("assignDays needs at least 5 distinct references");
  return days.map((day, i) => ({ day, reference: references[i], angle: angles?.[i] ?? "" }));
}

export function buildRepairPrompt({ day, reference, angle, issues, existingTitle }) {
  return [
    "Rewrite ONE devotional day. Output JSON ONLY, no markdown, no explanation.",
    `Day: ${day}. Scripture reference: ${reference}. Angle for this day, and only this angle: ${angle}.`,
    "For Scripture, output ONLY the reference, never the verse text.",
    `Problems with the previous version that you must fix: ${issues.join(" ")}`,
    existingTitle ? `Do not reuse this title: ${existingTitle}.` : "",
    "The new body must start differently from every other day, and must not repeat another day's ideas.",
    "JSON shape: {\"day\": \"" + day + "\", \"title\": \"...\", \"scripture\": {\"reference\": \"" + reference + "\"}, \"body\": \"...\", \"prayer\": \"...\"}",
    "Also output a matching kid version in the same JSON under \"kid\": {\"day\": \"" + day + "\", \"title\": \"...\", \"retelling\": \"...\", \"activity\": \"...\"}. The retelling must be plain words for ages 6-10, not a copy of the adult body.",
  ].join("\n");
}

export const DayRepair = z.object({
  day: z.string(),
  title: z.string().min(1),
  scripture: z.object({ reference: z.string().min(1) }),
  body: z.string().min(1),
  prayer: z.string().min(1),
  kid: z.object({
    day: z.string(),
    title: z.string().min(1),
    retelling: z.string().min(1),
    activity: z.string().min(1),
  }),
});
