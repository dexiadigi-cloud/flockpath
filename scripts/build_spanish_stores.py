#!/usr/bin/env python3
"""Build the Flockpath Spanish verse stores from the eBible USFM zips.

Inputs (already downloaded and md5-verified, see
output/research-spanish-verification-20261110.md):
  output/spanish-source/spaRV1909_usfm.zip  - Reina-Valera 1909, public domain
  output/spanish-source/spabes_usfm.zip     - La Biblia en Espanol Sencillo,
                                              2026 2nd edition, public domain

Outputs (same shape as the BSB stores: one flat JSON per book code,
keys like "GEN 1:1"):
  data/rv1909-<CODE>.json
  data/spabes-<CODE>.json

RV1909 REMAP (measured from the raw USFM, verified Nov 11 2026):
The file carries KJV numbering in most places, but 18 markers are blank
and 11 file-verses hold two or more KJV verses, so the content is all
present under adjacent numbers. This script normalizes to KJV numbering
at ingest: blank markers are dropped (their text sits in the next
chapter's first verse), shifted chapters are re-keyed, and merged
file-verses are split at explicit, hand-verified sentence boundaries.
Text conservation is asserted: joining the split parts with a single
space reproduces the original file verse exactly.

The 11 merged file-verses and their split points (start of the
second / next KJV verse):
  NUM 13:33  -> KJV 13:32 + 13:33   split before "Tambien vimos alli gigantes..."
  NUM 30:16  -> KJV 30:15 + 30:16   split before "Estas son las ordenanzas..."
  1SA 24:22  -> KJV 24:21 + 24:22   split before "Entonces David juro a Saul..."
  2SA 20:25  -> KJV 20:25 + 20:26   split before "e Ira Jaireo fue un jefe..."
  2CH 33:10  -> KJV 33:10 + 33:11   split before "por lo cual Jehova trajo..."
  JOB 35:15  -> KJV 35:15 + 35:16   split before "por eso Job abrio su boca..."
  JOB 39:30  -> KJV 39:27-30 + 40:1-5 (nine verses, eight split points)
  HOS 12:14  -> KJV 12:13 + 12:14   split before "Enojado ha Ephraim a Dios..."
  JON 2:10   -> KJV 2:9 + 2:10      split before "Y mando Jehova al pez..."
  ACT 19:40  -> KJV 19:40 + 19:41   split before "Y habiendo dicho esto, despidio..."
  2CO 13:12  -> KJV 13:12 + 13:13   split before "Todos los santos os saludan."

Shifted chapters (file verse -> KJV verse):
  NUM 13:1 -> 12:16; 13:N -> 13:(N-1) for N=2..32
  NUM 30:1 -> 29:40; 30:N -> 30:(N-1) for N=2..15
  1SA 24:1 -> 23:29; 24:N -> 24:(N-1) for N=2..21
  2CH 33:N -> 33:(N+1) for N=11..24
  JOB 39:1 -> 38:39; 39:2 -> 38:40; 39:3 -> 38:41; 39:N -> 39:(N-3) for N=4..29
  JOB 40:N -> 40:(N+5) for N=1..19
  HOS 12:1 -> 11:12; 12:N -> 12:(N-1) for N=2..13
  JON 2:1 -> 1:17; 2:N -> 2:(N-1) for N=2..9

Colophons (RV1909 only): the traditional KJV epistle subscriptions are
appended to the last verse of all 14 epistles, after "Amen.". They are
not verse text and are stripped by exact string match (14 strings,
each asserted present). The spabes files carry no colophons.

Verification performed by this script (fails loudly on any mismatch):
  - input counts: RV1909 31,102 markers / 31,084 non-blank / 18 blanks;
    spabes 31,102 markers / 31,102 non-blank / 0 blanks.
  - every split point found exactly once; joining the parts reproduces
    the original file verse.
  - every colophon found and stripped; the stripped verse ends "Amen.".
  - output: each store has exactly 31,102 non-blank verses.
  - the RV1909 output key set equals the spabes output key set exactly
    (spabes follows KJV numbering with no remap, so it is the
    independent reference for the KJV verse set).

Parser note: verse_store.parse_usfm's VERSE_RE mis-handles blank
verses (a blank \\v marker absorbs the next verse's text), so this
script parses USFM line by line instead. Do not "simplify" it back
to parse_usfm without fixing that first.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verse_store import clean_verse

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "output" / "spanish-source"
DATA = ROOT / "data"

# USFM book codes that differ from Flockpath codes.
CODEMAP = {"SNG": "SON", "EZK": "EZE", "JOL": "JOE", "NAM": "NAH"}

# Split points: (book, chapter, file verse) -> list of markers, each
# marking the start of the NEXT KJV verse in that file verse.
SPLITS = {
    ("NUM", "13", "33"): [
        "También vimos allí gigantes, hijos de Anac, raza de los gigantes: "
        "y éramos nosotros, á nuestro parecer, como langostas; "
        "y así les parecíamos á ellos.",
    ],
    ("NUM", "30", "16"): [
        "Estas son las ordenanzas que Jehová mandó á Moisés entre el varón "
        "y su mujer, entre el padre y su hija, durante su mocedad en casa "
        "de su padre.",
    ],
    ("1SA", "24", "22"): [
        "Entonces David juró á Saúl. Y fuése Saúl á su casa, y David y los "
        "suyos se subieron al sitio fuerte.",
    ],
    ("2SA", "20", "25"): [
        "é Ira Jaireo fué un jefe principal cerca de David.",
    ],
    ("2CH", "33", "10"): [
        "por lo cual Jehová trajo contra ellos los generales del ejército "
        "del rey de los Asirios, los cuales aprisionaron con grillos á "
        "Manasés, y atado con cadenas lleváronlo á Babilonia.",
    ],
    ("JOB", "35", "15"): [
        "por eso Job abrió su boca vanamente, y multiplica palabras "
        "sin sabiduría.",
    ],
    ("JOB", "39", "30"): [
        "Ella habita y está en la piedra, en la cumbre del peñasco y de la roca.",
        "Desde allí acecha la comida: sus ojos observan de muy lejos.",
        "Sus pollos chupan la sangre: y donde hubiere cadáveres, allí está.",
        "A más de eso respondió Jehová á Job, y dijo:",
        "¿Es sabiduría contender con el Omnipotente? El que disputa con Dios, responda á esto.",
        "Y respondió Job á Jehová, y dijo:",
        "He aquí que yo soy vil, ¿qué te responderé? Mi mano pongo sobre mi boca.",
        "Una vez hablé, y no responderé: aun dos veces, mas no tornaré á hablar.",
    ],
    ("HOS", "12", "14"): [
        "Enojado ha Ephraim á Dios con amarguras; por tanto, sus sangres se "
        "derramarán sobre él, y su Señor le pagará su oprobio.",
    ],
    ("JON", "2", "10"): [
        "Y mandó Jehová al pez, y vomitó á Jonás en tierra.",
    ],
    ("ACT", "19", "40"): [
        "Y habiendo dicho esto, despidió la concurrencia.",
    ],
    ("2CO", "13", "12"): [
        "Todos los santos os saludan.",
    ],
}

# The KJV verse each split part lands in (same order as SPLITS markers,
# plus the leading part). JOB 39:30 holds nine KJV verses.
SPLIT_TARGETS = {
    ("NUM", "13", "33"): [("13", "32"), ("13", "33")],
    ("NUM", "30", "16"): [("30", "15"), ("30", "16")],
    ("1SA", "24", "22"): [("24", "21"), ("24", "22")],
    ("2SA", "20", "25"): [("20", "25"), ("20", "26")],
    ("2CH", "33", "10"): [("33", "10"), ("33", "11")],
    ("JOB", "35", "15"): [("35", "15"), ("35", "16")],
    ("JOB", "39", "30"): [
        ("39", "27"), ("39", "28"), ("39", "29"), ("39", "30"),
        ("40", "1"), ("40", "2"), ("40", "3"), ("40", "4"), ("40", "5"),
    ],
    ("HOS", "12", "14"): [("12", "13"), ("12", "14")],
    ("JON", "2", "10"): [("2", "9"), ("2", "10")],
    ("ACT", "19", "40"): [("19", "40"), ("19", "41")],
    ("2CO", "13", "12"): [("13", "12"), ("13", "13")],
}

# Whole-chapter shifts: (book, chapter) -> function(file verse int) -> KJV (chapter, verse).
def _shift_num13(n):
    return ("12", "16") if n == 1 else ("13", str(n - 1))

def _shift_num30(n):
    return ("29", "40") if n == 1 else ("30", str(n - 1))

def _shift_1sa24(n):
    return ("23", "29") if n == 1 else ("24", str(n - 1))

def _shift_2ch33(n):
    # File 33:1-33:9 are KJV 33:1-33:9. The merge is at file 33:10
    # (KJV 33:10+33:11, split before shifts), so only 33:11..33:24
    # shift by one; file 33:25 is blank.
    return ("33", str(n + 1)) if n >= 11 else ("33", str(n))

def _shift_job39(n):
    if n == 1:
        return ("38", "39")
    if n == 2:
        return ("38", "40")
    if n == 3:
        return ("38", "41")
    return ("39", str(n - 3))

def _shift_job40(n):
    return ("40", str(n + 5))

def _shift_hos12(n):
    return ("11", "12") if n == 1 else ("12", str(n - 1))

def _shift_jon2(n):
    return ("1", "17") if n == 1 else ("2", str(n - 1))

def _shift_2co13(n):
    # File 13:12 is a split (handled before shifts); file 13:13 holds
    # KJV 13:14 plus the epistle colophon; file 13:14 is blank.
    return ("13", "14") if n == 13 else ("13", str(n))

SHIFTS = {
    ("NUM", "13"): _shift_num13,
    ("NUM", "30"): _shift_num30,
    ("1SA", "24"): _shift_1sa24,
    ("2CH", "33"): _shift_2ch33,
    ("JOB", "39"): _shift_job39,
    ("JOB", "40"): _shift_job40,
    ("HOS", "12"): _shift_hos12,
    ("JON", "2"): _shift_jon2,
    ("2CO", "13"): _shift_2co13,
}

# Epistle colophons appended after "Amen." in the RV1909 last verses.
COLOPHONS = {
    ("ROM", "16", "27"): " Fué escrita de Corinto á los Romanos, enviada por medio de Febe, diaconisa de la iglesia de Cencreas.",
    ("1CO", "16", "24"): " La primera á los Corintios fué enviada de Filipos con Estéfanas, y Fortunato, y Achâico, y Timoteo.",
    ("2CO", "13", "13"): " La segunda Epístola á los Corintios fué enviada de Filipos de Macedonia con Tito y Lucas.",
    ("GAL", "6", "18"): " Enviada de Roma á los Gálatas.",
    ("EPH", "6", "24"): " Escrita de Roma á los Efesios por Tichîco.",
    ("PHP", "4", "23"): " Escrita de Roma con Epafrodito.",
    ("COL", "4", "18"): " Escrita de Roma á los Colosenses; enviada con Tichîco y Onésimo.",
    ("1TH", "5", "28"): " La primera epístola á los Tesalonicenses fué escrita de Atenas.",
    ("2TH", "3", "18"): " La segunda Epístola á los Tesalonicenses fué escrita de Atenas.",
    ("1TI", "6", "21"): " La primera epístola á Timoteo fué escrita de Laodicea, que es metrópoli de la Frigia Pacatiana.",
    ("2TI", "4", "22"): " La segunda epístola á Timoteo, el cual fué el primer obispo ordenado en Efeso, fué escrita de Roma, cuando Pablo fué presentado la segunda vez á César Nerón.",
    ("TIT", "3", "15"): " A Tito, el cual fué el primer obispo ordenado á la iglesia de los Cretenses, escrita de Nicópolis de Macedonia.",
    ("PHM", "1", "25"): " A Filemón fué enviada de Roma por Onésimo, siervo.",
    ("HEB", "13", "25"): " Fué escrita á los Hebreos desde Italia con Timoteo.",
}


def read_usfm(zip_path, suffix):
    out = {}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            m = re.match(r"(\d+)-([A-Z0-9]+)" + re.escape(suffix) + r"\.usfm$", name)
            if m:
                out[CODEMAP.get(m.group(2), m.group(2))] = z.read(name).decode("utf-8")
    return out


def parse_line_based(text):
    """{(chapter, verse): cleaned text}. A \\v line's text is the rest
    of its line plus following non-marker continuation lines, until the
    next \\v or \\c. Blank verses parse to an empty string."""
    verses = {}
    chapter = None
    cur = None
    buf = []

    def flush():
        if cur is not None:
            verses[cur] = clean_verse(" ".join(buf))

    for line in text.splitlines():
        m = re.match(r"\\c\s+(\d+)\s*$", line.strip())
        if m:
            flush()
            chapter = m.group(1)
            cur = None
            buf = []
            continue
        m = re.match(r"\\v\s+(\d+[a-z]?)\s*(.*)$", line.strip())
        if m:
            flush()
            cur = (chapter, m.group(1))
            buf = [m.group(2)] if m.group(2) else []
            continue
        if cur is not None and line.strip():
            buf.append(line.strip())
    flush()
    return verses


def split_file_verse(text, markers):
    """Split a merged file verse at each marker. Returns the parts in
    order. Asserts text conservation: joining the parts with a single
    space reproduces the original text exactly."""
    parts = []
    rest = text
    for marker in markers:
        idx = rest.find(marker)
        assert idx > 0, f"split marker not found: {marker!r} in {text[:80]!r}"
        assert rest.find(marker, idx + 1) == -1, f"split marker ambiguous: {marker!r}"
        parts.append(rest[:idx].rstrip())
        rest = rest[idx:]  # marker plus everything after it
    parts.append(rest)
    assert " ".join(parts) == text, f"text conservation failed: {text[:80]!r}"
    return parts


def build_rv1909(books):
    """Apply the KJV-normalizing remap. Returns {code: {key: text}}."""
    store = {}
    total_markers = 0
    total_nonblank = 0
    blanks = []
    for code in sorted(books):
        verses = parse_line_based(books[code])
        total_markers += len(verses)
        out = {}
        for (ch, num), text in sorted(verses.items(), key=lambda kv: (int(kv[0][0]), int(kv[0][1].rstrip("abcdefghijklmnopqrstuvwxyz")))):
            if not text:
                blanks.append(f"{code} {ch}:{num}")
                continue
            total_nonblank += 1
            key = (code, ch, num)
            if key in SPLITS:
                parts = split_file_verse(text, SPLITS[key])
                targets = SPLIT_TARGETS[key]
                assert len(parts) == len(targets), f"split/target mismatch {key}"
                for part, (tch, tnum) in zip(parts, targets):
                    tkey = f"{code} {tch}:{tnum}"
                    assert tkey not in out, f"remap collision at {tkey}"
                    out[tkey] = part
                continue
            if key in COLOPHONS:
                tail = COLOPHONS[key]
                assert text.endswith(tail), f"colophon not found at end of {key}: {text[-80:]!r}"
                text = text[: -len(tail)]
                assert text.endswith("Amén."), f"colophon strip left bad ending at {key}: {text[-40:]!r}"
            if (code, ch) in SHIFTS:
                tch, tnum = SHIFTS[(code, ch)](int(num))
                tkey = f"{code} {tch}:{tnum}"
                assert tkey not in out, f"remap collision at {tkey}"
                out[tkey] = text
            else:
                tkey = f"{code} {ch}:{num}"
                assert tkey not in out, f"remap collision at {tkey}"
                out[tkey] = text
        store[code] = out
    return store, total_markers, total_nonblank, blanks


def build_spabes(books):
    """No remap needed. Asserts zero blanks and no colophon tails."""
    store = {}
    total_markers = 0
    total_nonblank = 0
    for code in sorted(books):
        verses = parse_line_based(books[code])
        total_markers += len(verses)
        out = {}
        for (ch, num), text in verses.items():
            assert text, f"unexpected blank marker in spabes: {code} {ch}:{num}"
            assert "fué enviada" not in text and "fué escrita" not in text, (
                f"unexpected colophon-like text in spabes {code} {ch}:{num}"
            )
            out[f"{code} {ch}:{num}"] = text
            total_nonblank += 1
        store[code] = out
    return store, total_markers, total_nonblank


def main():
    rv_books = read_usfm(SRC / "spaRV1909_usfm.zip", "spaRV1909")
    sp_books = read_usfm(SRC / "spabes_usfm.zip", "spabes")
    assert len(rv_books) == 66, f"RV1909 books: {len(rv_books)}"
    assert len(sp_books) == 66, f"spabes books: {len(sp_books)}"

    rv_store, rv_markers, rv_nonblank, rv_blanks = build_rv1909(rv_books)
    sp_store, sp_markers, sp_nonblank = build_spabes(sp_books)

    print(f"RV1909 in:  markers={rv_markers} non-blank={rv_nonblank} blanks={len(rv_blanks)}")
    print(f"  blanks: {sorted(rv_blanks)}")
    print(f"spabes in: markers={sp_markers} non-blank={sp_nonblank} blanks=0")
    assert rv_markers == 31102, f"RV1909 markers {rv_markers} != 31102"
    assert rv_nonblank == 31084, f"RV1909 non-blank {rv_nonblank} != 31084"
    assert len(rv_blanks) == 18, f"RV1909 blanks {len(rv_blanks)} != 18"
    assert sp_markers == 31102 and sp_nonblank == 31102

    rv_total = sum(len(v) for v in rv_store.values())
    sp_total = sum(len(v) for v in sp_store.values())
    print(f"RV1909 out: {rv_total} verses")
    print(f"spabes out: {sp_total} verses")
    assert rv_total == 31102, f"RV1909 output {rv_total} != 31102"
    assert sp_total == 31102, f"spabes output {sp_total} != 31102"

    rv_keys = {k for v in rv_store.values() for k in v}
    sp_keys = {k for v in sp_store.values() for k in v}
    assert rv_keys == sp_keys, (
        f"RV1909 key set differs from spabes: "
        f"only-RV1909={sorted(rv_keys - sp_keys)[:10]} "
        f"only-spabes={sorted(sp_keys - rv_keys)[:10]}"
    )
    print("Key sets identical: RV1909 == spabes (KJV verse set).")

    for code in sorted(rv_store):
        with open(DATA / f"rv1909-{code}.json", "w", encoding="utf-8") as f:
            json.dump(dict(sorted(rv_store[code].items())), f, ensure_ascii=False, indent=1)
        with open(DATA / f"spabes-{code}.json", "w", encoding="utf-8") as f:
            json.dump(dict(sorted(sp_store[code].items())), f, ensure_ascii=False, indent=1)
    print(f"Wrote {len(rv_store)} rv1909-*.json and {len(sp_store)} spabes-*.json files to {DATA}.")


if __name__ == "__main__":
    main()
