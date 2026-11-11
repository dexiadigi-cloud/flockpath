import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { COLORING_TEMPLATES, matchColoring } from "../lib/coloring.mjs";
import { formatRef, formatRefsInText } from "../lib/refs.mjs";

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
// and only when it overflows. The check is a length
// threshold (300 characters); a verse at or under it
// prints in full. Over it, the print shows an exact
// excerpt of the BSB store text, cut at a word boundary
// (never mid-word), with an ellipsis so the reader knows
// it continues. The pack's stored text and the review
// page keep the full verse; only the print shortens it.
// The shortened text is never a paraphrase.
const VERSE_PRINT_MAX = 300;
function shortenVerse(text) {
  const t = String(text ?? "");
  if (t.length <= VERSE_PRINT_MAX) return t;
  const cut = t.slice(0, VERSE_PRINT_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const head = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd().replace(/[,;:]+$/, "");
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
= ${esc(a.day)}: ${esc(formatRefsInText(a.title))}

*Scripture: ${esc(formatRef(a.scripture.reference))}*
#rect(inset: 10pt, stroke: 0.5pt)[${quote(shortenVerse(a.scripture.text))}]

${para(formatRefsInText(a.body))}

_Prayer:_ ${para(formatRefsInText(a.prayer))}

== For kids (ages 6-10): ${esc(formatRefsInText(k.title))}

${para(formatRefsInText(k.retelling))}

_Activity:_ ${para(formatRefsInText(k.activity))}
`;
}).join("\n#pagebreak()\n");

const questions = pack.leaderQuestions.map((q, i) => `${i + 1}. ${esc(formatRefsInText(q.question))}\n\n${q.leaderNote ? `_Leader note:_ ${para(formatRefsInText(q.leaderNote))}\n` : ""}`).join("\n");

// Oct 31, 2026, hash placement: families do not need the hash,
// so it is small (7pt) and pushed to the very bottom of the
// last page, above the footer, with #v(1fr) where it is used.
// It is kept because it proves what the pastor approved.
const hashBox = `#align(center)[#rect(inset: 6pt, stroke: 0.5pt)[
  #text(7pt)[Approval code: #text(7pt, font: "DejaVu Sans Mono")[${pack.lockHash}]]

  #text(7pt)[Scripture in this pack is the Berean Standard Bible,
  verified character for character against the verse store before locking.
  Kid versions are retellings, not Scripture quotes.]
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
  pack.classicDevotional ? `= Classic devotional: ${esc(pack.classicDevotional.title)}

_From ${esc(classicFrom)}, anchored to ${esc(formatRef(pack.classicDevotional.anchor_ref))} (public domain). This is a classic text, not generated text._

${classicQuote}
` : "",
  (pack.leaderQuestions ?? []).length ? `= Small-group leader page

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
const sourcesBlock = classicLeader && sourceLabels.length
  ? `\n\n#text(9pt)[_Sources for this pack:_ ${esc(sourceLabels.join("; "))}. Every source is public domain. Labels name the author's tradition so the pastor can judge each voice.]`
  : "";
const classicLeaderWithSources = classicLeader + sourcesBlock;

const song = pack.hymn ? `= Hymn: ${esc(pack.hymn.title)}

_Tune: ${esc(pack.hymn.tune)}, ${esc(pack.hymn.tuneComposer)}. Words: ${esc(pack.hymn.author)} (${esc(pack.hymn.authorYears)}), ${pack.hymn.wordsYear}. Meter: ${esc(pack.hymn.meter)}._

_Public domain._

${quote(pack.hymn.lyrics)}

#v(1fr)
#text(9pt)[${esc(pack.hymn.sourceNote)} Source: ${esc(pack.hymn.sourceUrl)} Sheet music and audio are on the share page.]
` : pack.chorus ? `= Original chorus (legacy pack only): ${esc(pack.chorus.title)}

_Original, written for this pack. Not a known worship lyric._

${para(pack.chorus.chordPro)}

#v(1fr)
#text(9pt)[Original chorus, written for this pack. There is no sheet music or audio link for an original chorus; hymn pages link to sheet music and audio on the share page.]
` : "";

const coloring = pack.coloring ? `= Coloring: ${esc(pack.coloring.title.replace(/ Coloring$/, ""))}

${para(pack.coloring.description)}

#v(1em)
#align(center)[#image("../public/coloring/${coloringFile}", width: 90%)]

#v(1fr)
${hashBox}
` : "";

// Nov 1, 2026, section toggles: the PDF renders only the
// sections in the locked pack, in order, up to 9 pages for a
// full pack, fewer for a subset. The hash box lives under
// the coloring page when coloring is included, otherwise at
// the end of the last section, so a pack without coloring
// still carries its hash and verification note.
const sections = [];
if (days) sections.push(days);
if (classicLeaderWithSources) sections.push(classicLeaderWithSources);
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
let churchLogoFile = null;
if (pack.churchLogo && /^church-logos\/[A-Za-z0-9._-]+\.(png|jpg|jpeg)$/i.test(pack.churchLogo)) {
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
const pastorChurch = [pack.pastorName, pack.church].filter(Boolean).map(esc).join(", ");
const footerLeft = pastorChurch ? `${pastorChurch} | ${esc(pack.title)}` : esc(pack.title);
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
      label: "Pastor's note",
      lines: [
        `*${esc(formatRef(pack.pastorNote.verse.reference))}*`,
        quote(shortenVerse(pack.pastorNote.verse.text)),
        para(formatRefsInText(pack.pastorNote.note)),
      ].join("\n\n  "),
    };
  }
  if ((pack.sermonSnapshot?.summary ?? "").trim()) {
    const parts = [para(formatRefsInText(pack.sermonSnapshot.summary))];
    if (pack.sermonSnapshot.quote) parts.push(quote(formatRefsInText(pack.sermonSnapshot.quote)));
    return { label: "From the sermon", lines: parts.join("\n\n  ") };
  }
  return null;
})();
const typ = `#set page(paper: "us-letter", margin: 0.75in, footer: context if counter(page).get().first() == 1 { [] } else { grid(columns: (1fr, auto), align(left)[#text(9pt)[${footerLeft}]], align(right)[#text(9pt)[#link("https://www.flockpath.si")[www.flockpath.si] | Page #counter(page).display()]]) })
#set text(size: 12pt)
#set heading(numbering: none)

#align(center)[
${churchLogoFile ? `  #image("${churchLogoFile}", width: 24%)\n\n  #v(0.5em)\n` : ""}  #text(26pt, weight: "bold")[${esc(pack.title)}]

  #text(14pt)[${esc(pack.passage)}]

  #text(12pt)[A week of family discipleship]
]

#v(0.6em)
#align(center)[#rect(inset: 14pt, stroke: 1pt)[
  *Memory verse: ${esc(formatRef(pack.memoryVerse.reference))}*

  ${quote(shortenVerse(pack.memoryVerse.text))}
]]

#v(0.6em)
#align(center)[
  Approved by ${esc(pack.pastorName)}, ${esc(pack.church)}
]
${coverNote ? `
#v(0.6em)
#align(center)[#rect(inset: 12pt, stroke: 0.5pt)[
  *${coverNote.label}*

  ${coverNote.lines}
]]` : ""}

#v(1fr)
#align(center)[
${logoExists ? `  #image("logo.png", width: 22%)\n\n  #v(0.5em)\n` : ""}  #text(10pt)[Made with love and by the grace of God - #link("https://www.flockpath.si")[www.flockpath.si]]
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
