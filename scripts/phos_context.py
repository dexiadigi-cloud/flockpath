"""Step 7.5 Phase B: Phos context bundle for Flockpath.

Reads the Phos study database directly (local copy of the
Scripture Desk / Phos repo, ~/workspace/scripture-desk/data/study.db).
In production this reads the bundled Phos database, not a remote
API. The locked design is a bundled database shipped with the app.

IMPORTANT QUIRK, found while building this and documented here
so it is not reintroduced: commentaries use 1-indexed book order
(Genesis 1, Psalms 19, John 43), while crossrefs use 0-indexed
book order (Genesis 0, Psalms 18, John 42). Using one order for
both tables returns the wrong book's cross-references. This
script maps both explicitly.

Bundle per verse:
- verse text, from the Flockpath verse store (bsb), not from
  Phos, so the verified store stays the single source for quotes.
- TSK cross-references, first 8 in canonical order, with the
  note that a cross-reference is a link to look up, not a verse
  to quote unless it is also in the verse store and verified.
- Commentary excerpts, verse-specific preferred, otherwise
  chapter/range, first 400 characters, always with source title
  and Public Domain rights. Long commentary is never pasted
  whole into a pack; the model uses it as context, the leader
  page may carry one short attributed quote.
- Lexicon notes, from interlinear Strong's words, content words
  only, with transliteration, gloss, and a short definition.
- Devotional anchors, where a Phos devotional anchors to any
  verse in the passage (e.g. Spurgeon on Psalm 23:4, My Utmost
  on John 3:16). These are optional classic pages, labeled
  with source, never generated text presented as classic.

Usage:
  python3 scripts/phos_context.py "JHN 3:3,JHN 3:5,JHN 3:16,JHN 3:17,JHN 3:36" data/phos-jhn3.json
  python3 scripts/phos_context.py "PSA 23:1,PSA 23:2,PSA 23:3,PSA 23:4,PSA 23:6" data/phos-psa23.json
  python3 scripts/phos_context.py "PSA 23:1,PSA 23:2,PSA 23:3,PSA 23:4,PSA 23:6" data/phos-psa23.json --tradition baptist

Nov 2, 2026, denomination preset: --tradition orders the bundle.
Nov 16, 2026, v57 hard filter: --tradition ALSO filters the
bundle. A bundle entry whose Phos sensitivity is "opt-in" appears
only when its tradition key equals the pastor's --tradition key;
for every other pastor it is dropped before ordering, so it can
never be the classic devotional, enter the devotional rotation,
or reach a model prompt. General entries are never filtered. No
--tradition (or a key with no opt-in voices) means no opt-in
entry passes, which is the safe default. The default
(non-denominational, other, congregational) keeps today's order
exactly for general voices. Dictionaries, encyclopedias, and
liturgy are not in the bundle yet (PHOS-USE-IN-PACKS.md), so
presets whose voices live only there order nothing here, and
their signup messages say so. This changes which excerpts the
model sees, never the prompts, temps, gates, or verse text, so
v23 generation logic is untouched.
"""
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

FLOCKPATH = Path(__file__).resolve().parent.parent

# Nov 3, 2026, Mac test package: the study database is no
# longer assumed to live in the VM's workspace. Resolution
# order: an explicit FLOCKPATH_PHOS_DB pointer wins, then a
# phos.db shipped inside the app (data/phos.db, the Mac
# package layout), then the legacy VM path. A missing file
# is a clear error, never an empty SQLite database:
# connecting to a nonexistent path would silently create
# one and fail later with a confusing "no such table".
def resolve_phos_db():
    env = os.environ.get("FLOCKPATH_PHOS_DB")
    if env and Path(env).is_file():
        return Path(env)
    app_db = FLOCKPATH / "data" / "phos.db"
    if app_db.is_file():
        return app_db
    return Path.home() / "workspace" / "scripture-desk" / "data" / "study.db"

def require_phos_db():
    db = resolve_phos_db()
    if not db.is_file():
        raise SystemExit(
            "Phos database not found. Set FLOCKPATH_PHOS_DB to its path, "
            "or ship data/phos.db inside the app, or place it at "
            "~/workspace/scripture-desk/data/study.db."
        )
    return db

PHOS_DB = resolve_phos_db()

# code -> (commentary book name, commentary order 1-indexed,
#          crossref order 0-indexed, interlinear book name,
#          devotional anchor book name, flockpath store file)
BOOKS = {
    # Expanded Oct 31, 2026, after a real sermon test failed on ISA/TIT:
    # the old 5-book map made multi-book plans fail closed. Orders
    # verified against study.db Oct 31: commentaries 1-indexed,
    # crossrefs 0-indexed, same canonical order in both tables.
    "GEN": ("Genesis", 1, 0, "Genesis", "Genesis", "data/bsb-GEN.json"),
    "EXO": ("Exodus", 2, 1, "Exodus", "Exodus", "data/bsb-EXO.json"),
    "LEV": ("Leviticus", 3, 2, "Leviticus", "Leviticus", "data/bsb-LEV.json"),
    "NUM": ("Numbers", 4, 3, "Numbers", "Numbers", "data/bsb-NUM.json"),
    "DEU": ("Deuteronomy", 5, 4, "Deuteronomy", "Deuteronomy", "data/bsb-DEU.json"),
    "JOS": ("Joshua", 6, 5, "Joshua", "Joshua", "data/bsb-JOS.json"),
    "JDG": ("Judges", 7, 6, "Judges", "Judges", "data/bsb-JDG.json"),
    "RUT": ("Ruth", 8, 7, "Ruth", "Ruth", "data/bsb-RUT.json"),
    "1SA": ("1 Samuel", 9, 8, "1 Samuel", "1 Samuel", "data/bsb-1SA.json"),
    "2SA": ("2 Samuel", 10, 9, "2 Samuel", "2 Samuel", "data/bsb-2SA.json"),
    "1KI": ("1 Kings", 11, 10, "1 Kings", "1 Kings", "data/bsb-1KI.json"),
    "2KI": ("2 Kings", 12, 11, "2 Kings", "2 Kings", "data/bsb-2KI.json"),
    "1CH": ("1 Chronicles", 13, 12, "1 Chronicles", "1 Chronicles", "data/bsb-1CH.json"),
    "2CH": ("2 Chronicles", 14, 13, "2 Chronicles", "2 Chronicles", "data/bsb-2CH.json"),
    "EZR": ("Ezra", 15, 14, "Ezra", "Ezra", "data/bsb-EZR.json"),
    "NEH": ("Nehemiah", 16, 15, "Nehemiah", "Nehemiah", "data/bsb-NEH.json"),
    "EST": ("Esther", 17, 16, "Esther", "Esther", "data/bsb-EST.json"),
    "JOB": ("Job", 18, 17, "Job", "Job", "data/bsb-JOB.json"),
    "PSA": ("Psalms", 19, 18, "Psalms", "Psalm", "data/bsb-PSA.json"),
    "PRO": ("Proverbs", 20, 19, "Proverbs", "Proverbs", "data/bsb-PRO.json"),
    "ECC": ("Ecclesiastes", 21, 20, "Ecclesiastes", "Ecclesiastes", "data/bsb-ECC.json"),
    "SON": ("Song of Songs", 22, 21, "Song of Songs", "Song of Songs", "data/bsb-SON.json"),
    "ISA": ("Isaiah", 23, 22, "Isaiah", "Isaiah", "data/bsb-ISA.json"),
    "JER": ("Jeremiah", 24, 23, "Jeremiah", "Jeremiah", "data/bsb-JER.json"),
    "LAM": ("Lamentations", 25, 24, "Lamentations", "Lamentations", "data/bsb-LAM.json"),
    "EZE": ("Ezekiel", 26, 25, "Ezekiel", "Ezekiel", "data/bsb-EZE.json"),
    "DAN": ("Daniel", 27, 26, "Daniel", "Daniel", "data/bsb-DAN.json"),
    "HOS": ("Hosea", 28, 27, "Hosea", "Hosea", "data/bsb-HOS.json"),
    "JOE": ("Joel", 29, 28, "Joel", "Joel", "data/bsb-JOE.json"),
    "AMO": ("Amos", 30, 29, "Amos", "Amos", "data/bsb-AMO.json"),
    "OBA": ("Obadiah", 31, 30, "Obadiah", "Obadiah", "data/bsb-OBA.json"),
    "JON": ("Jonah", 32, 31, "Jonah", "Jonah", "data/bsb-JON.json"),
    "MIC": ("Micah", 33, 32, "Micah", "Micah", "data/bsb-MIC.json"),
    "NAH": ("Nahum", 34, 33, "Nahum", "Nahum", "data/bsb-NAH.json"),
    "HAB": ("Habakkuk", 35, 34, "Habakkuk", "Habakkuk", "data/bsb-HAB.json"),
    "ZEP": ("Zephaniah", 36, 35, "Zephaniah", "Zephaniah", "data/bsb-ZEP.json"),
    "HAG": ("Haggai", 37, 36, "Haggai", "Haggai", "data/bsb-HAG.json"),
    "ZEC": ("Zechariah", 38, 37, "Zechariah", "Zechariah", "data/bsb-ZEC.json"),
    "MAL": ("Malachi", 39, 38, "Malachi", "Malachi", "data/bsb-MAL.json"),
    "MAT": ("Matthew", 40, 39, "Matthew", "Matthew", "data/bsb-MAT.json"),
    "MRK": ("Mark", 41, 40, "Mark", "Mark", "data/bsb-MRK.json"),
    "LUK": ("Luke", 42, 41, "Luke", "Luke", "data/bsb-LUK.json"),
    "JHN": ("John", 43, 42, "John", "John", "data/bsb-JHN.json"),
    "ACT": ("Acts", 44, 43, "Acts", "Acts", "data/bsb-ACT.json"),
    "ROM": ("Romans", 45, 44, "Romans", "Romans", "data/bsb-ROM.json"),
    "1CO": ("1 Corinthians", 46, 45, "1 Corinthians", "1 Corinthians", "data/bsb-1CO.json"),
    "2CO": ("2 Corinthians", 47, 46, "2 Corinthians", "2 Corinthians", "data/bsb-2CO.json"),
    "GAL": ("Galatians", 48, 47, "Galatians", "Galatians", "data/bsb-GAL.json"),
    "EPH": ("Ephesians", 49, 48, "Ephesians", "Ephesians", "data/bsb-EPH.json"),
    "PHP": ("Philippians", 50, 49, "Philippians", "Philippians", "data/bsb-PHP.json"),
    "COL": ("Colossians", 51, 50, "Colossians", "Colossians", "data/bsb-COL.json"),
    "1TH": ("1 Thessalonians", 52, 51, "1 Thessalonians", "1 Thessalonians", "data/bsb-1TH.json"),
    "2TH": ("2 Thessalonians", 53, 52, "2 Thessalonians", "2 Thessalonians", "data/bsb-2TH.json"),
    "1TI": ("1 Timothy", 54, 53, "1 Timothy", "1 Timothy", "data/bsb-1TI.json"),
    "2TI": ("2 Timothy", 55, 54, "2 Timothy", "2 Timothy", "data/bsb-2TI.json"),
    "TIT": ("Titus", 56, 55, "Titus", "Titus", "data/bsb-TIT.json"),
    "PHM": ("Philemon", 57, 56, "Philemon", "Philemon", "data/bsb-PHM.json"),
    "HEB": ("Hebrews", 58, 57, "Hebrews", "Hebrews", "data/bsb-HEB.json"),
    "JAS": ("James", 59, 58, "James", "James", "data/bsb-JAS.json"),
    "1PE": ("1 Peter", 60, 59, "1 Peter", "1 Peter", "data/bsb-1PE.json"),
    "2PE": ("2 Peter", 61, 60, "2 Peter", "2 Peter", "data/bsb-2PE.json"),
    "1JN": ("1 John", 62, 61, "1 John", "1 John", "data/bsb-1JN.json"),
    "2JN": ("2 John", 63, 62, "2 John", "2 John", "data/bsb-2JN.json"),
    "3JN": ("3 John", 64, 63, "3 John", "3 John", "data/bsb-3JN.json"),
    "JUD": ("Jude", 65, 64, "Jude", "Jude", "data/bsb-JUD.json"),
    "REV": ("Revelation", 66, 65, "Revelation", "Revelation", "data/bsb-REV.json"),
}

STOP_GLOSSES = {"the", "this", "who", "he", "she", "it", "self", "a", "an", "of", "in", "to", "for", "and", "is", "are", "not"}

def parse_ref(ref):
    # v28, Nov 5, 2026: a range resolves to its start verse
    # for the crossrefs and commentary queries, which are
    # verse-anchored; the verse text itself is the full
    # range, resolved by resolve_verse_text below.
    code, rest = ref.split(" ", 1)
    ch, v = rest.split(":")
    return code, int(ch), int(v.split("-")[0])


def resolve_verse_text(ref, store):
    # v28, Nov 5, 2026: a range is one passage unit, so its
    # text is the joined text of its verses. A single verse
    # returns its own text. A missing verse yields "",
    # the same as a missing single verse here (the bundle
    # is study context, not the Scripture text; the
    # generation and lock paths resolve ranges strictly).
    m = re.match(r"^([A-Z0-9]+) (\d+):(\d+)(?:-(\d+))?$", str(ref or "").strip())
    if not m:
        return store.get(ref, "")
    code, ch, v1, v2 = m.group(1), m.group(2), int(m.group(3)), m.group(4)
    if not v2:
        return store.get(f"{code} {ch}:{v1}", "")
    parts = [store.get(f"{code} {ch}:{v}", "") for v in range(v1, int(v2) + 1)]
    if any(not p for p in parts):
        return ""
    return " ".join(parts)


# Nov 2, 2026, denomination preset: denomination key -> the bundle
# sources that sort first for that pastor. Keys not listed here
# (non-denominational, other, congregational) order nothing, which
# keeps today's order exactly. Anglican sorts JFB first because
# Fausset was an Irish Anglican evangelical; the Book of Common
# Prayer is not in the bundle, so it cannot sort here. Catholic
# sorts the two Catholic devotionals first, which is what puts
# them in the classic-devotional rotation once they anchor to a
# verse (the classic devotional is the first anchored devotional
# in bundle order). Nov 16, 2026, v57: the two Catholic
# devotionals carry no verse anchor in the current bundle DB
# (their anchor_ref is empty; they are chapter/letter works,
# not verse-anchored daily devotionals), so today they cannot
# enter the rotation for ANY pastor, Catholic included. That is
# a data gap, not this filter: the filter below is what
# guarantees they never appear for a pastor who has not opted
# into the Catholic tradition, anchors or no anchors.
PREFERRED_VOICES = {
    "baptist": {"gill", "spurgeon", "treasury_of_david"},
    "presbyterian": {"barnes_nt", "matthew_henry", "calvin"},
    "methodist": {"clarke"},
    "lutheran": {"keil_delitzsch"},
    "reformed": {"calvin"},
    "anglican": {"jfb"},
    "catholic": {"imitation_christ", "practice_presence"},
}


def preferred_first(entries, preferred, key):
    """Stable partition: preferred sources first, original order kept."""
    if not preferred:
        return entries
    first = [e for e in entries if e[key] in preferred]
    rest = [e for e in entries if e[key] not in preferred]
    return first + rest


# Nov 16, 2026, v57 hard filter (Jeremiah, Nov 16: "Add a hard
# filter"): a bundle entry whose Phos sensitivity is "opt-in"
# appears ONLY for a pastor who opted into that tradition, i.e.
# whose --tradition key equals the entry's tradition key. Every
# other pastor never sees it: not as the classic devotional, not
# in the devotional rotation, not in commentary, not in a model
# prompt. General entries (sensitivity "general", or an older DB
# with no sensitivity at all) always pass. No --tradition means
# no opt-in entry passes. Returns (kept, dropped_count).
def filter_opt_in(entries, tradition):
    kept, dropped = [], 0
    for e in entries:
        if e.get("sensitivity") == "opt-in" and e.get("tradition") != tradition:
            dropped += 1
            continue
        kept.append(e)
    return kept, dropped


def clean_excerpt(text, max_chars):
    """Cut a source excerpt without ever breaking a word.

    Nov 3, 2026, permanent cut-off fix: a plain [:N] slice ended
    excerpts mid-word in packs (the Psalm 23 page 7 classic ended
    on a bare "b"). This helper collapses whitespace, then, when
    the text runs past the cap, backs off to the last sentence
    end (. ! ?) inside the window, or to the last space when no
    sentence ends inside it, and appends an ellipsis so the cut
    reads as an excerpt, never as a complete sentence. Text that
    fits the cap returns unchanged, with no ellipsis. Every
    excerpt this bundle ships goes through here, so no future
    excerpt can end mid-word again.
    """
    t = " ".join((text or "").split())
    if len(t) <= max_chars:
        return t
    window = t[:max_chars]
    cut = -1
    for mark in (". ", "! ", "? "):
        cut = max(cut, window.rfind(mark))
    if cut >= 0:
        return window[:cut + 1].rstrip() + "\u2026"
    space = window.rfind(" ")
    if space > 0:
        return window[:space].rstrip() + "\u2026"
    return window.rstrip() + "\u2026"


def _bsb_verse_text(code, ch, v, cache):
    """BSB text of one verse, for the names-occurrence check below.

    Loads data/bsb-<code>.json per book, cached. A missing file,
    bad JSON, or missing verse returns "", which fails the check,
    so an unverifiable link is dropped, never cited.
    """
    if code not in cache:
        try:
            cache[code] = json.loads(
                (FLOCKPATH / BOOKS[code][5]).read_text(encoding="utf-8"))
        except (OSError, ValueError, KeyError):
            cache[code] = {}
    return cache[code].get(f"{code} {ch}:{v}", "")


# Nov 20, 2026, v62 (item 6): the divine-name stoplist, used
# by _name_occurs_in_verse below. Lowercased for comparison;
# "GOD" and "Lord" match through it too.
DIVINE_NAME_STOPLIST = {"god", "lord"}


def _name_occurs_in_verse(name, name_forms_json, verse_text):
    """True when the proper name itself occurs in the verse text.

    Nov 20, 2026, v61 fix (item 15): TIPNR links a name to a
    verse by Strong's number, so a verse that only mentions the
    related common noun links too -- Judah via G2453 "Jews",
    Javan via G1672/G1674 "Greek/Greeks" -- and the names note
    used to print that link as "(named in Romans 3:9)", a false
    citation. A form counts only as a whole word in the verse's
    BSB text: "Jew" does not match "Jews", "Greek" does not
    match "Greeks". Forms come from the bundle's name_forms
    (comma-split, bracket junk dropped), plus the canonical
    name itself. A form with no capital letter is skipped:
    TIPNR's list mixes name spellings ("Juda", "of Judah")
    with lowercase gloss words ("he", "go", "accuser",
    "a troop"), and a printed proper name is capitalized,
    so a lowercase form cannot be the name itself -- it can
    only false-positive (Peter via "he", Hamath via "go").
    The canonical name is always kept, so no true occurrence
    is lost. A name with no such verse in the passage is
    dropped at fill time, never cited falsely.

    Nov 20, 2026, v62 fix (item 6): the divine-name stoplist.
    TIPNR's LORD entry (H3068) carries "God", "LORD", and
    "Lord" as forms, so Genesis 1:1 ("In the beginning God
    created...") cited LORD as "(named in Genesis 1:1)", and
    Israel's forms carry "God" too, so any verse saying "God"
    could cite Israel. The rule is: the divine name is never
    cited as a proper name in a names note -- these forms are
    struck from the occurrence check, so a name counts only
    when one of its other forms occurs. It is NOT "never cite
    Genesis 1:1": a real name that genuinely occurs there
    still cites it. LORD itself can then never cite anywhere,
    which is the point: the divine name is not a proper name
    for the note. The same strike keeps Jesus from citing a
    verse that only says "Lord".
    """
    forms = {str(name or "").strip()}
    try:
        raw_forms = json.loads(name_forms_json or "[]")
    except ValueError:
        raw_forms = []
    for f in raw_forms:
        for part in str(f).split(","):
            part = part.strip().strip("[]").strip()
            if part and any(c.isupper() for c in part):
                forms.add(part)
    forms.discard("")
    # v62 divine-name stoplist (item 6): "God" and "LORD"/"Lord"
    # never count as an occurrence, canonical name included.
    forms = {f for f in forms if f.strip().lower() not in DIVINE_NAME_STOPLIST}
    text = verse_text or ""
    for form in forms:
        if re.search(r"\b" + re.escape(form) + r"\b", text, re.IGNORECASE):
            return True
    return False


def main():
    args = sys.argv[1:]
    tradition = None
    if "--tradition" in args:
        i = args.index("--tradition")
        tradition = args[i + 1] if i + 1 < len(args) else None
        del args[i:i + 2]
    # Nov 19, 2026, Viz.Bible Phase 1: places are opt-in only.
    # Without --places the bundle is byte-identical to before, so
    # v23 generation defaults are untouched. With it, the bundle
    # gains a "places" field (see below) built from the Phos
    # places / place_verses tables (OpenBible.info, CC BY 4.0).
    include_places = False
    if "--places" in args:
        include_places = True
        del args[args.index("--places")]
    # Nov 19, 2026, Viz.Bible Phase 2: names are opt-in only.
    # Without --names the bundle is byte-identical to before, so
    # v23 generation defaults are untouched. With it, the bundle
    # gains a "names" field (see below) built from the Phos
    # proper_names / proper_name_verses tables (STEPBible TIPNR,
    # CC BY 4.0), with the Hitchcock meaning (public domain)
    # looked up per name.
    include_names = False
    if "--names" in args:
        include_names = True
        del args[args.index("--names")]
    # Nov 19, 2026, Viz.Bible Phase 3: topics are opt-in only, and
    # take a topic value: --topics <topic>. Without it the bundle is
    # byte-identical to before. With it, the bundle gains a "topics"
    # field (see below) built from the Phos topics_openbible table
    # (OpenBible.info Topical Bible, CC BY 4.0, curated 77 topics).
    include_topics = None
    if "--topics" in args:
        i = args.index("--topics")
        include_topics = args[i + 1] if i + 1 < len(args) else None
        del args[i:i + 2]
    # Nov 19, 2026, v60 fixes: the topics fill reads its verse
    # text from a verse store, and the store must be the pack's
    # own translation, not always BSB. A Spanish pack's topics
    # note printed English BSB verses because the fill had no
    # translation option. Default bsb keeps every existing
    # caller byte-identical. Only the topics fill uses this;
    # the main bundle verses stay BSB, as before.
    topics_translation = "bsb"
    if "--translation" in args:
        i = args.index("--translation")
        topics_translation = args[i + 1] if i + 1 < len(args) else "bsb"
        del args[i:i + 2]
    if topics_translation not in ("bsb", "rv1909", "spabes"):
        print(f"Unknown translation: {topics_translation}", file=sys.stderr)
        return 2
    if len(args) != 2:
        print("usage: phos_context.py <refs_csv> <out.json> [--tradition <key>] [--places] [--names] [--topics <topic>] [--translation <code>]", file=sys.stderr)
        return 2
    refs = args[0].split(",")
    out_path = Path(args[1])
    preferred = PREFERRED_VOICES.get(tradition or "", set())
    con = sqlite3.connect(require_phos_db())
    con.row_factory = sqlite3.Row
    # Tradition labels, Nov 2, 2026, from the Phos sources table
    # (scripts/add_tradition_labels.py in the Phos repo). Guarded:
    # an older database without the columns still builds a bundle,
    # with labels None, instead of failing the whole generation.
    cols = {r[1] for r in con.execute("PRAGMA table_info(sources)")}
    labels = {}
    if "tradition" in cols:
        for r in con.execute("SELECT source_id, title, tradition, tradition_label, sensitivity FROM sources"):
            labels[r[0]] = {"title": r[1], "tradition": r[2], "tradition_label": r[3], "sensitivity": r[4]}
    bundle = {"verses": [], "sources_note": "All study material is Public Domain, per Phos sources table. Commentary excerpts are excerpts, not whole entries. Cross-references are links, not quotes."}
    # Nov 16, 2026, v57 hard filter: count of opt-in voices
    # dropped for this pastor's tradition, printed below.
    opt_in_dropped = 0
    for ref in refs:
        code, ch, v = parse_ref(ref)
        comm_book, comm_order, xref_order, inter_book, anchor_book, store_file = BOOKS[code]
        store = json.loads((FLOCKPATH / store_file).read_text(encoding="utf-8"))
        verse_text = resolve_verse_text(ref, store)
        # Crossrefs, 0-indexed order, first 8
        xrefs = con.execute(
            "SELECT ref_book, ref_chapter, ref_verse FROM crossrefs "
            "WHERE book_order=? AND chapter=? AND verse=? ORDER BY ref_book_order, ref_chapter, ref_verse LIMIT 8",
            (xref_order, ch, v)).fetchall()
        # Commentary: verse-specific first, then range/chapter, max 2 sources, excerpt 400 chars
        comm = con.execute(
            "SELECT source_id, start_chapter, start_verse, end_chapter, end_verse, text FROM commentaries "
            "WHERE book_order=? AND (start_chapter < ? OR (start_chapter=? AND start_verse<=?)) "
            "AND (end_chapter > ? OR (end_chapter=? AND (end_verse=0 OR end_verse>=?))) "
            "ORDER BY (start_verse = ? AND end_verse = ?) DESC, source_id LIMIT 6",
            (comm_order, ch, ch, v, ch, ch, v, v, v)).fetchall()
        # Prefer one entry per source, verse-specific first, then
        # the denomination preset: the pastor's tradition voices
        # sort first, everything else keeps today's order. Max 2.
        seen, comm_unique = set(), []
        for row in comm:
            if row["source_id"] in seen:
                continue
            seen.add(row["source_id"])
            lab = labels.get(row["source_id"], {})
            comm_unique.append({
                "source": row["source_id"],
                "title": lab.get("title") or row["source_id"],
                "tradition": lab.get("tradition"),
                "tradition_label": lab.get("tradition_label"),
                "sensitivity": lab.get("sensitivity"),
                "range": f"{ch}:{row['start_verse']}-{row['end_verse']}" if row["start_verse"] else f"chapter {ch}",
                "excerpt": clean_excerpt(row["text"], 400),
            })
        # Nov 16, 2026, v57 hard filter: opt-in entries are
        # dropped BEFORE ordering, so a filtered voice never
        # takes one of the two commentary slots.
        comm_unique, comm_dropped = filter_opt_in(comm_unique, tradition)
        opt_in_dropped += comm_dropped
        comm_out = preferred_first(comm_unique, preferred, "source")[:2]
        # Lexicon: interlinear content words, max 4
        words = con.execute(
            "SELECT word, transliteration, gloss, strongs FROM interlinear_words "
            "WHERE book=? AND chapter=? AND verse=? ORDER BY position",
            (inter_book, ch, v)).fetchall()
        lex_out, seen_strong = [], set()
        for w in words:
            gloss = (w["gloss"] or "").strip().lower()
            # Glosses like "the/this/who" are articles/pronouns, not
            # content words. Filter on the first token before "/".
            first_gloss = gloss.split("/")[0].strip()
            if first_gloss in STOP_GLOSSES or gloss in STOP_GLOSSES or not w["strongs"] or w["strongs"] in seen_strong:
                continue
            seen_strong.add(w["strongs"])
            # Open-source audit, Nov 1, 2026: this query
            # intentionally takes the first lexicon row for a
            # Strong number, which may be Strong's (PD), BDB
            # (CC BY), or STEPBible (CC BY). Pinning it to
            # Strong's alone was tried and rejected: Strong's
            # uses unpadded numbers (G25, not G0025) and lacks
            # entries like G2316, so the pin emptied definitions
            # for common words like love and God. CC BY data
            # is open, free, and commercial-use allowed with
            # attribution, and that attribution lives in
            # OPEN-SOURCE.md and on the /credits page, which
            # is the correct fix, not degrading the bundle.
            lex = con.execute("SELECT definition FROM lexicon WHERE strongs_number=? LIMIT 1", (w["strongs"],)).fetchone()
            lex_out.append({
                "word": w["word"], "transliteration": w["transliteration"],
                "gloss": w["gloss"], "strongs": w["strongs"],
                "definition": clean_excerpt(lex[0] if lex else "", 220),
            })
            if len(lex_out) >= 4:
                break
        bundle["verses"].append({
            "reference": ref,
            "text": verse_text,
            "crossrefs": [f"{r[0]} {r[1]}:{r[2]}" for r in xrefs],
            "commentary": comm_out,
            "lexicon": lex_out,
        })
    # Devotional anchors for any verse in the passage
    anchor_refs = []
    for ref in refs:
        code, ch, v = parse_ref(ref)
        anchor_refs.append(f"{BOOKS[code][4]} {ch}:{v}")
    placeholders = ",".join("?" * len(anchor_refs))
    devs = con.execute(
        f"SELECT source_id, title, anchor_ref, body FROM devotionals WHERE anchor_ref IN ({placeholders}) ORDER BY source_id LIMIT 100",
        tuple(anchor_refs)).fetchall()
    dev_all = []
    for d in devs:
        lab = labels.get(d[0], {})
        dev_all.append({
            "source": d[0], "title": d[1], "anchor_ref": d[2],
            "excerpt": clean_excerpt(d[3], 400),
            "workTitle": lab.get("title"),
            "tradition": lab.get("tradition"),
            "tradition_label": lab.get("tradition_label"),
            "sensitivity": lab.get("sensitivity"),
        })
    # Same preset rule as commentary: the pastor's tradition
    # devotionals sort first, the rest keep source_id order.
    # The classic devotional is the first anchored devotional in
    # bundle order, so this is what puts a Catholic pastor's
    # Catholic devotionals in the classic rotation.
    # Nov 16, 2026, v57 hard filter: opt-in devotionals are
    # dropped BEFORE ordering, so a filtered voice can never be
    # the classic devotional or enter the rotation.
    dev_all, dev_dropped = filter_opt_in(dev_all, tradition)
    opt_in_dropped += dev_dropped
    bundle["devotionals"] = preferred_first(dev_all, preferred, "source")[:5]
    # Nov 19, 2026, Viz.Bible Phase 1, --places only: places
    # named in the passage's own verses, from place_verses.
    # Cap 2 places per day, 3 per pack, high confidence first.
    # A place is listed once per pack even when several verses
    # name it. Low-confidence places are listed with confidence
    # "low" and no coordinates, never a guessed point. The
    # bundle carries the raw rows; the leader-page note and
    # the sources line are built from this field downstream.
    if include_places:
        places_out, seen_places = [], set()
        # Guarded: an older database without the places tables
        # still builds a bundle, with an empty places list, instead
        # of failing the whole generation.
        has_places = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='places'"
        ).fetchone()[0]
        if has_places:
            for ref in refs:
                if len(places_out) >= 3:
                    break
                code, ch, v = parse_ref(ref)
                book_name = BOOKS[code][0]
                rows = con.execute(
                    "SELECT p.place_id, p.name, p.modern_name, "
                    "p.latitude, p.longitude, p.confidence, p.score, "
                    "p.place_type FROM places p "
                    "JOIN place_verses pv ON pv.place_id = p.place_id "
                    "WHERE pv.book=? AND pv.chapter=? AND pv.verse=? "
                    "ORDER BY CASE p.confidence WHEN 'high' THEN 0 "
                    "WHEN 'medium' THEN 1 ELSE 2 END, p.name",
                    (book_name, ch, v)).fetchall()
                day_count = 0
                for r in rows:
                    if len(places_out) >= 3 or day_count >= 2:
                        break
                    if r["place_id"] in seen_places:
                        continue
                    seen_places.add(r["place_id"])
                    day_count += 1
                    places_out.append({
                        "place_id": r["place_id"],
                        "name": r["name"],
                        "modern_name": r["modern_name"],
                        "latitude": r["latitude"],
                        "longitude": r["longitude"],
                        "confidence": r["confidence"],
                        "score": r["score"],
                        "place_type": r["place_type"],
                        "verse": ref,
                    })
        bundle["places"] = places_out
        bundle["places_source"] = (
            "Place data courtesy of OpenBible.info, "
            "licensed under CC BY 4.0.")
    # Nov 19, 2026, Viz.Bible Phase 2, --names only: proper
    # names in the passage's own verses, from proper_name_verses.
    # Cap 2 names per day, 3 per pack. A name is listed once per
    # pack even when several verses name it. The meaning comes
    # from Hitchcock's Bible Names Dictionary (public domain,
    # already in Phos) first; TIPNR is the cross-check and the
    # verse list, via family_links. No AI description text is
    # carried: TIPNR's brief / short / article descriptions were
    # never ingested. The bundle carries the raw rows; the
    # leader-page note and the sources line are built from this
    # field downstream.
    # Nov 20, 2026, v61 fix (item 15): a TIPNR link alone is
    # not proof the name occurs in the verse (see
    # _name_occurs_in_verse). The fill keeps only links whose
    # verse text actually contains the name as a whole word;
    # a name with no such verse in this passage is dropped.
    if include_names:
        names_out, seen_names = [], set()
        bsb_store_cache = {}
        # Guarded: an older database without the proper_names tables
        # still builds a bundle, with an empty names list, instead
        # of failing the whole generation.
        has_names = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='proper_names'"
        ).fetchone()[0]
        if has_names:
            for ref in refs:
                if len(names_out) >= 3:
                    break
                code, ch, v = parse_ref(ref)
                book_name = BOOKS[code][0]
                rows = con.execute(
                    "SELECT pn.name_id, pn.name, pn.kind, "
                    "pn.strong_numbers, pn.name_forms, pn.family_links "
                    "FROM proper_names pn "
                    "JOIN proper_name_verses pv "
                    "ON pv.name_id = pn.name_id "
                    "WHERE pv.book=? AND pv.chapter=? AND pv.verse=? "
                    "ORDER BY CASE pn.kind WHEN 'person' THEN 0 "
                    "WHEN 'place' THEN 1 ELSE 2 END, pn.name",
                    (book_name, ch, v)).fetchall()
                day_count = 0
                for r in rows:
                    if len(names_out) >= 3 or day_count >= 2:
                        break
                    if r["name_id"] in seen_names:
                        continue
                    # Nov 20, 2026, v61 fix (item 15): the link
                    # is by Strong's number, so a verse that
                    # only has the related common noun ("Jews",
                    # "Greeks") links too. Keep the link only
                    # when the verse's own BSB text contains the
                    # proper name itself. Not marked seen on a
                    # miss, so the same name can still count at
                    # another passage verse where it does occur.
                    verse_text = _bsb_verse_text(code, ch, v, bsb_store_cache)
                    if not _name_occurs_in_verse(
                            r["name"], r["name_forms"], verse_text):
                        continue
                    seen_names.add(r["name_id"])
                    day_count += 1
                    meaning_row = con.execute(
                        "SELECT text FROM dictionaries "
                        "WHERE source_id='hitchcock' "
                        "AND lower(term)=lower(?) LIMIT 1",
                        (r["name"],)).fetchone()
                    try:
                        family = json.loads(r["family_links"] or "{}")
                    except ValueError:
                        family = {}
                    names_out.append({
                        "name_id": r["name_id"],
                        "name": r["name"],
                        "kind": r["kind"],
                        "strong_numbers": json.loads(
                            r["strong_numbers"] or "[]"),
                        "family_links": family,
                        "meaning": (meaning_row["text"]
                                    if meaning_row else None),
                        "verse": f"{book_name} {ch}:{v}",
                    })
        bundle["names"] = names_out
        bundle["names_source"] = (
            "Proper names: STEP Bible (www.STEPBible.org), CC BY 4.0.")
    # Nov 19, 2026, Viz.Bible Phase 3, --topics <topic> only:
    # supporting verses for one pastor-picked topic, from
    # topics_openbible, best-voted first (vote_rank 1, 2, 3...).
    # TOPIC PACKS ONLY, never sermon packs: the flag itself is the
    # opt-in, and the adult devotional still starts from the week's
    # passage, never from this list. Cap 3 per pack: a topic is
    # pack-level, not day-anchored, so only the 3-per-pack half of
    # the places/names cap pattern applies. A verse is listed once,
    # with its text from the pack's translation store (BSB for an
    # English pack, rv1909 / spabes for a Spanish pack, via
    # --translation; never ESV text from OpenBible). A row whose
    # text cannot be resolved (e.g. the one cross-chapter range, 2 Peter 2:19-3:12, which
    # the store resolver does not span) is skipped and the next
    # ranked row is taken instead, so the note always carries 3
    # quotable verses when the topic has them. If the topic does
    # not match one of the 77 curated topics, the field stays empty.
    if include_topics:
        topics_out = []
        # Guarded: an older database without the topics table still
        # builds a bundle, with an empty topics list, instead of
        # failing the whole generation.
        has_topics = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='topics_openbible'"
        ).fetchone()[0]
        if has_topics and include_topics.strip():
            code_by_book = {v[0]: k for k, v in BOOKS.items()}
            store_cache = {}
            rows = con.execute(
                "SELECT verse_ref, book, chapter, verse, end_chapter, "
                "end_verse FROM topics_openbible "
                "WHERE lower(topic)=lower(?) ORDER BY vote_rank",
                (include_topics.strip(),)).fetchall()
            for r in rows:
                if len(topics_out) >= 3:
                    break
                code = code_by_book.get(r["book"])
                if not code:
                    continue
                if code not in store_cache:
                    # Nov 19, 2026, v60 fixes: the topics verse
                    # text comes from the pack's translation store
                    # (rv1909 / spabes for a Spanish pack), never
                    # hard-coded to BSB. A missing store file for
                    # a book skips that verse instead of failing
                    # the whole bundle; the next ranked row is
                    # taken instead, the same as an unresolvable
                    # reference.
                    store_file = FLOCKPATH / f"data/{topics_translation}-{code}.json"
                    if not store_file.exists():
                        continue
                    store_cache[code] = json.loads(
                        store_file.read_text(encoding="utf-8"))
                ref = f"{code} {r['chapter']}:{r['verse']}"
                if r["end_chapter"] is not None:
                    if r["end_chapter"] == r["chapter"]:
                        ref += f"-{r['end_verse']}"
                    else:
                        ref += f"-{r['end_chapter']}:{r['end_verse']}"
                text = resolve_verse_text(ref, store_cache[code])
                if not text:
                    continue
                topics_out.append({
                    "topic": include_topics.strip(),
                    "verse_ref": r["verse_ref"],
                    "text": text,
                })
        bundle["topics"] = topics_out
        bundle["topics_topic"] = include_topics.strip() if include_topics else ""
        bundle["topics_source"] = (
            "Topical data: OpenBible.info (CC BY 4.0).")
    out_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=1), encoding="utf-8")
    for verse in bundle["verses"]:
        print(f"{verse['reference']}: {len(verse['crossrefs'])} crossrefs, {len(verse['commentary'])} commentary, {len(verse['lexicon'])} lexicon")
        print(f"  crossrefs: {', '.join(verse['crossrefs'][:4])}")
        if verse["commentary"]:
            print(f"  commentary: {verse['commentary'][0]['source']} - {verse['commentary'][0]['excerpt'][:120]}...")
        if verse["lexicon"]:
            print(f"  lexicon: {', '.join(w['transliteration'] + ' (' + w['gloss'] + ', ' + w['strongs'] + ')' for w in verse['lexicon'])}")
    print(f"Devotionals anchored: {len(bundle['devotionals'])}")
    for d in bundle["devotionals"]:
        print(f"  {d['source']}: {d['title']} ({d['anchor_ref']})")
    if include_places:
        print(f"Places in passage: {len(bundle.get('places', []))}")
        for p in bundle.get("places", []):
            print(f"  {p['name']} (modern: {p['modern_name'] or 'uncertain'}, "
                  f"confidence: {p['confidence']}, verse: {p['verse']})")
    if include_names:
        print(f"Names in passage: {len(bundle.get('names', []))}")
        for n in bundle.get("names", []):
            print(f"  {n['name']} ({n['kind']}, "
                  f"meaning: {n['meaning'] or 'none'}, verse: {n['verse']})")
    if include_topics:
        print(f"Topic verses for '{include_topics}': "
              f"{len(bundle.get('topics', []))}")
        for t in bundle.get("topics", []):
            print(f"  {t['verse_ref']}: {t['text'][:100]}...")
    # Nov 16, 2026, v57 hard filter: opt-in voices excluded for
    # this tradition (0 is normal for a Catholic pastor and for
    # passages no opt-in voice anchors to).
    print(f"Opt-in voices excluded for tradition {tradition or 'none'}: {opt_in_dropped}")
    print(f"Wrote {out_path}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
