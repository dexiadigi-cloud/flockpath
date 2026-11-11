#!/usr/bin/env python3
"""Build the Flockpath email HTML body from a locked pack.

Email template standard, locked Nov 1, 2026, from the iPhone Mail
test (v2): PDF-like separation, inline styles only, no external
images, fonts, or scripts, so it renders in Apple Mail and Gmail
and reads offline once downloaded.

Send shape (locked Nov 1, 2026): the email is ONE body format,
HTML, plus the PDF attachment. No plain-text version is built
or offered, and no standalone HTML file is pushed at iPhone
members. If HTML ever fails for a member, the PDF is the fallback.

Layout rules (do not regress):
- 600px max width, explicit 17px body, Georgia serif.
- Each day, the leader section, and the song section start with a
  thick divider and page-break-before, like the PDF. On screen the
  break is invisible and the divider + margin give separation;
  printed from Mail, the email comes out at 8 pages (header + 5
  days + leader + song, no coloring page; the PDF is 9 with coloring).
- Scripture sits in its own left-bordered block inside each day.
- The kid section is divided inside each day, not blended into
  the adult text.
- Coloring lives in the attached PDF, never as an image in the
  email body (mail clients handle images unreliably).
- A hymn pack gets its Hymnary link + sheet music/audio note;
  a chorus pack gets no hymn sheet-music note.

Usage:
  python3 scripts/build-email.py data/locked-pack.json output/pack-email.html
  python3 scripts/build-email.py data/locked-pack.json output/pack-email.html --test-note
"""
import argparse
import html
import json
from pathlib import Path


def esc(s):
    return html.escape(str(s or ""))


def paras(s, size=17):
    return "".join(
        f'<p style="margin:0 0 12px 0;font-size:{size}px;line-height:1.6;">{esc(p)}</p>'
        for p in str(s or "").split("\n")
        if p.strip()
    )


def build(d, test_note=False, pastor_message=""):
    parts = []
    parts.append(
        '<div style="font-family:Georgia,serif;color:#222222;max-width:600px;'
        'margin:0 auto;padding:0 8px;font-size:17px;line-height:1.6;">'
    )
    if pastor_message:
        # Pastor's own regular text, above the pack HTML, in his
        # voice, editable before sending. This is what makes the
        # email read as a personal note from the pastor, not a
        # template dump, and it also gives every send unique text.
        parts.append(paras(pastor_message))
        parts.append('<div style="border-top:1px solid #999999;margin:8px 0 24px 0;"></div>')
    parts.append(f'<h1 style="font-size:26px;line-height:1.2;margin:0 0 6px 0;">{esc(d["title"])}</h1>')
    parts.append(
        f'<p style="font-size:17px;margin:0 0 16px 0;">{esc(d["passage"])} - '
        "A week of family discipleship</p>"
    )
    parts.append(
        '<div style="border:1px solid #999999;padding:14px;margin:0 0 16px 0;">'
        f'<p style="margin:0 0 6px 0;"><strong>Memory verse: '
        f'{esc(d["memoryVerse"]["reference"])}</strong></p>'
        f'<p style="margin:0;">{esc(d["memoryVerse"]["text"])}</p></div>'
    )
    parts.append(
        f'<p style="margin:0 0 8px 0;">Approved by {esc(d["pastorName"])}, '
        f'{esc(d["church"])}</p>'
    )
    if test_note:
        parts.append(
            '<p style="margin:0 0 8px 0;font-size:14px;"><em>Test email: same pack, '
            "with PDF-like separation between sections. Coloring page is in "
            "the attached PDF.</em></p>"
        )
    for a, k in zip(d["adultDevotionals"], d["kidDevotionals"]):
        parts.append(
            '<div style="border-top:3px solid #222222;padding-top:18px;'
            'margin-top:32px;page-break-before:always;">'
        )
        parts.append(
            f'<h2 style="font-size:22px;line-height:1.2;margin:0 0 10px 0;">'
            f'{esc(a["day"])}: {esc(a["title"])}</h2>'
        )
        parts.append(
            '<div style="border-left:4px solid #999999;padding-left:12px;'
            'margin:0 0 14px 0;"><p style="margin:0;"><em>'
            f'{esc(a["scripture"]["reference"])}: {esc(a["scripture"]["text"])}'
            "</em></p></div>"
        )
        parts.append(paras(a["body"]))
        parts.append(
            f'<p style="margin:0 0 14px 0;"><strong>Prayer:</strong> '
            f'{esc(a["prayer"])}</p>'
        )
        parts.append(
            '<div style="border-top:1px solid #999999;padding-top:14px;margin-top:8px;">'
        )
        parts.append(
            f'<h3 style="font-size:18px;margin:0 0 10px 0;">For kids (ages 6-10): '
            f'{esc(k["title"])}</h3>'
        )
        parts.append(paras(k["retelling"]))
        parts.append(
            f'<p style="margin:0;"><strong>Activity:</strong> {esc(k["activity"])}</p>'
        )
        parts.append("</div></div>")
    parts.append(
        '<div style="border-top:3px solid #222222;padding-top:18px;'
        'margin-top:32px;page-break-before:always;">'
    )
    parts.append(
        '<h2 style="font-size:22px;margin:0 0 14px 0;">Small-group leader questions</h2>'
    )
    for i, q in enumerate(d["leaderQuestions"], 1):
        parts.append(f'<div style="margin:0 0 16px 0;"><p style="margin:0 0 6px 0;"><strong>{i}.</strong> {esc(q["question"])}</p>')
        if q.get("leaderNote"):
            parts.append(f'<p style="margin:0;"><em>Leader note:</em> {esc(q["leaderNote"])}</p>')
        parts.append("</div>")
    parts.append("</div>")
    parts.append(
        '<div style="border-top:3px solid #222222;padding-top:18px;'
        'margin-top:32px;page-break-before:always;">'
    )
    if d.get("hymn"):
        h = d["hymn"]
        parts.append(
            f'<h2 style="font-size:22px;margin:0 0 10px 0;">Hymn: {esc(h["title"])}</h2>'
        )
        parts.append(
            f'<p style="margin:0 0 10px 0;"><em>Tune: {esc(h["tune"])}, '
            f'{esc(h["tuneComposer"])}. Words: {esc(h["author"])} '
            f'({esc(h["authorYears"])}), {h["wordsYear"]}. Meter: {esc(h["meter"])}.</em></p>'
        )
        parts.append("<p style=\"margin:0 0 10px 0;\">Public domain.</p>")
        parts.append(paras(h["lyrics"]))
        parts.append(
            f'<p style="margin:16px 0 0 0;">Source: {esc(h["sourceUrl"])} '
            "Sheet music and audio are on the share page.</p>"
        )
    elif d.get("chorus"):
        c = d["chorus"]
        parts.append(
            f'<h2 style="font-size:22px;margin:0 0 10px 0;">Original chorus: '
            f'{esc(c["title"])}</h2>'
        )
        parts.append(paras(c.get("chordPro", "")))
    parts.append('<p style="margin:16px 0 0 0;">Coloring page: see the attached PDF.</p>')
    parts.append(
        "<p style=\"margin:16px 0 0 0;\">Made with love and by the grace of God - "
        "www.flockpath.si</p>"
    )
    parts.append("</div></div>")
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("out")
    ap.add_argument("--test-note", action="store_true")
    ap.add_argument("--pastor-message", default="",
                    help="Pastor's own regular text, placed above the pack HTML.")
    args = ap.parse_args()
    d = json.loads(Path(args.pack).read_text(encoding="utf-8"))
    Path(args.out).write_text(
        build(d, args.test_note, args.pastor_message), encoding="utf-8"
    )
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
