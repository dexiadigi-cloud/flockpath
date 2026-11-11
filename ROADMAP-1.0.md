# Flockpath 1.0 Roadmap

Locked 1.0 definition (Nov 1, 2026): local generation, local Phos,
print plus a sendable offline file, basically fully offline except
one-time install, the send step itself, and external hymn links.
Email send is one body format, HTML, plus the PDF attachment.
WhatsApp and print are PDF only. No plain-text version, no HTML
file pushed at iPhone members.
DECISIONS Nov 1, 2026 (Jeremiah):
- No QR in 1.0. Cover QR removed from the 1.0 plan, not gated,
  just out. QR is shelved post-1.0.
- Standalone offline HTML file shelved post-1.0. 1.0 send is
  PDF (print, WhatsApp, file send). The email HTML body
  template (build-email.py) is retained for post-1.0 Send
  wiring, but no standalone HTML file ships in a 1.0 pack.
- Coloring border frame: closed, not a big deal, keep as-is.
  No re-render, no crop, not now.
- Scripture: BSB only. No WEB for demo or future packs. The
  old WEB canonical sample is legacy only, not the demo pack.
- Code repository: deferred, not now. Revisit in about a week
  when the tool/app is more solid and complete.
- Demo/test account: create close to the planned submission
  date, not now.
Coloring and hymns are bonus, cherry on top, not the core. The
meat (adult/kid devotionals, leader questions, Scripture
exactness, Phos used to full potential) must be amazing and
cannot be wrong.

Audit note, Nov 1, 2026: this roadmap was NOT complete before
this audit. Gaps found and added below: QR gating, coloring
border-frame decision, submission blanks checklist, demo pack
WEB vs BSB, generation-time estimate, minimum spec measurement,
per-field review highlighting, sheet music/MIDI, and email
verification/reset. The roadmap numbering error ("Send wiring
sits at step 5") was also fixed to step 6.

## Plan adjustment Nov 2, 2026 (Jeremiah: "Good plan")

Two tracks added, submission order unchanged:

- **Denomination track, IN BUILD Nov 2, 2026.** Tradition labels
  for all 31 Phos resources (researched Nov 2), served by a new
  Phos API endpoint, stored as a pastor setting (signup question,
  optional and skippable, changeable in settings, local only),
  shown on every excerpt in review, on per-pack "Voices" toggles,
  and on the PDF leader-page sources list. Preset, not wall:
  the setting picks voices first, never locks a pastor out.
  Catholic is a cherry on top only (devotional rotation, no
  canon or doctrine change). Other is a plain fallback to the
  non-denominational default, no free text. Every option shows a
  customized post-selection message (adjustments + privacy:
  stored only on the pastor's computer). Design:
  `DENOMINATION-SETTINGS-DESIGN.md`. Target: in the submission
  if verified stable, else held, never rushed in broken.
- **Long game, AFTER submission.** Member mode for all Christians
  (pastor/member toggle, personal packs labeled "Not
  pastor-approved," Saved instead of Approved and Locked,
  discussion questions, member-to-pastor approval bridge),
  then daily devotionals, word studies, and the "go deeper"
  background layer. Design: `FLOCKPATH-FOR-ALL-CHRISTIANS.md`.
  Member mode is NOT built before submission; the submission
  leads with pastor mode and names member mode as direction.
- **Resource-use expansion** (PHOS-USE-IN-PACKS.md steps,
  dictionaries, encyclopedias, liturgy opt-in, leader sources
  list) continues as the feed for both tracks. v23 generation
  stays locked; only source selection changes under a
  denomination preset, never prompts, temps, or gates.

## Order (Nov 1, 2026 sequencing decision)

1. **Meat decision LOCKED Nov 1, 2026 (Jeremiah).** v23 locked,
   product completion. v24 surveyed rewrite call NOT built.
   v23 is lockable with 7 pastor-editable warnings.
   Persistent meat issues, pastor-reviewed not version-blocking:
   Thu surveyed, Fri verbatim variance, Wed draw-God activity,
   Mon/Tue kid overlap/imports. No further generation version
   work unless Jeremiah reopens this decision.
2. **flockpath.si site LIVE Nov 1 night.** Netlify flockpath.netlify.app, INWX apex ALIAS + www CNAME, old A records removed, HTTPS live. Site v1 is for the hackathon, updates later as needed.
   No QR in 1.0 (Jeremiah, Nov 1): the cover QR step is removed,
   not gated. Hosted public share is NOT 1.0; opt-in hosted
   publish of locked packs only is v2, QR shelved post-1.0.
3. **Pastor-role test (Jeremiah) first, then real pastor end-to-end test + family print test.** Manual
   file send works for this: PDF + email HTML from
   `scripts/build-email.py`, sent from the pastor's own mail app.
   One-tap send is not required for this test.
   Pastor-role test IN PROGRESS Nov 2, 2026: fresh John 3 pack
   generated on Mac in 93.1 sec (John 3:3, 3:5, 3:16, 3:17, 3:36,
   memory verse John 3:16), reviewed, gate rule changed
   (Jeremiah, Nov 2: kid naming Jesus in a New Testament
   passage where the verse says Son is a warning, not a block,
   because the Son is Jesus; Old Testament and non-Son verses
   still block), kid Thu/Fri titles approved ("Saved, Not
   Condemned", "Believe and Live Forever"), locked as
   Jeremiah Lee, Home Church (test), lock hash
   08223d24b82d0a86c14bf4651c15f618940ba692809b9d0c774c26053f75e7d9.
   PDF builder FIXED Nov 2 (Jeremiah approved): build-pdf.mjs
   now takes a pack file and output PDF, runs typst itself,
   cover QR removed, and locking builds the pack's PDF via
   POST /api/packs/pdf, offered on the review page and the
   pack page as pack-<id>.pdf (legacy pack-job- files still
   offered as fallback). Canonical pack untouched.
   Pastor decisions Nov 2, 2026: (1) Full book names in
   display only (lib/refs.mjs, PDF, review, pack page),
   internal codes unchanged, lock hashes unchanged.
   (2) Original choruses REMOVED, song page is hymn-only,
   no song if no hymn matches; legacy chorus packs still
   render and lock. Hymn index must grow from 17 toward a
   great amount of verified PD hymns, in verified batches
   with a matcher test each batch, so most passages have
   a hymn to choose from. (3) Leader notes end with a
   code-appended "Read <day verse>." in order, editable
   in review, not counted in the 40-70 word note band,
   displayed in full book names in the PDF.
   Decisions already made for this step (Jeremiah, Nov 1):
   - Coloring border frame: closed, keep as-is, not a big deal.
   - Demo pack: BSB only, no WEB. A BSB demo pack is used,
     the old WEB canonical sample is legacy only.
4. **Demo video (5 minutes or less) + up to 5 screenshots +
   hackathon submission.** Due Nov 27, 2026, 11:59 PM ET.
   Showcase Dec 1, 2026.
   Submission blanks to close in this step, not invent:
   - Demo video link (required, not made yet).
   - Live demo link (not deployed yet, never a localhost link).
   - Screenshots (up to 5): review page with gates, input
     page, finished PDF page, share page with QR, coloring page.
   - Code repository: Flockpath is not a git repo yet.
     Deferred (Jeremiah, Nov 1): revisit in about a week
     when the tool/app is more solid and complete. Never
     paste a guessed URL.
   - Test/demo account: no dedicated demo account yet.
     Deferred (Jeremiah, Nov 1): create close to the planned
     submission date. Never paste a real pastor account.
   - Built-window checkbox: check only at final submit.
   - Site log cleanup before submit (Jeremiah, Nov 1): add robots.txt to stop bot 404 noise, and trace/fix the /data:, 404 requests seen in Netlify logs on launch night (425 requests, 29.88% errors, mostly bot probes and www redirects, not real visitor traffic). Verify Netlify logs are clean before final submit.
5. **Phos bundling into the app (QUEUED, after steps 1-4, NOT
   done yet).** What exists today is `scripts/phos_context.py`
   reading the dev copy of study.db and building a per-passage
   bundle JSON, which `generate_sections.py` consumes. What is
   NOT done: trimming study.db to only the tables generation
   uses (commentaries, lexicon, crossrefs, devotionals),
   bundling that trimmed DB into the pastor app, querying it
   in-app with node:sqlite instead of a pre-made bundle, and
   updating the outdated phos_context.py docstring that still
   says production should call a Phos API. Bundled, not API,
   is the locked design. Manual bundle generation already works
   for a real pastor test, so this is after the submission
   deadline, not a blocker for it.
   Also queued with the app build, same stage:
   - Generation-time estimate: replace hardcoded about-20-minute
     strings with a per-spec estimate at install/first run,
     as a range not a promise, refining live, warning and
     offering background generation or a subset pack if very long.
   - Minimum spec measurement: honest disk and RAM minimums
     (model 1.8 GB + trimmed Phos + BSB store), measured, not
     invented, before any spec number is promised to pastors.
6. **Send screen wiring (QUEUED, after steps 1-4).** One-tap Send
   in the pastor app, built on the already-locked builders:
   `scripts/build-email.py` (pastor message on top, pack HTML,
   PDF attached) and `scripts/build-pdf.mjs` (9-page PDF).
   Scope: pastor's own church email connection, pastor message
   editor, channel recommendation (email = HTML body + PDF,
   WhatsApp = PDF only, print = PDF), WhatsApp PDF flow test,
   Gmail app rendering test. Manual send already works, so this
   is polish after the submission deadline, not a blocker for it.
7. **Later, not 1.0.** Hymn growth 17 toward 30-50 in verified
   batches with a matcher test each batch. Opt-in hosted publish
   of locked packs only (v2). A full Hymn Desk API server is a
   separate, later, not-yet-approved step. Sheet music notation
   inside the PDF and direct MIDI/audio hosting (song page is
   lyrics only today; share page links to Hymnary for score
   and audio). Per-field highlighting in the review screen
   (the quality-gate flag list is built; per-field highlighting
   is not). Email verification and password reset by email:
   open decision, likely unnecessary for a local app with
   local accounts; do not build by default.

## Why Send wiring sits at step 6

The submission deadline outranks it, manual file send already
covers a real pastor test, and wiring a Send screen into the
current prototype before the meat decision and the site are done
would be polish before the core and the deadline are safe.
