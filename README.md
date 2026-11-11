# Flockpath

From Sunday's sermon to a week of family discipleship, pastor-approved and printable.

Flockpath turns a sermon, a topic, a verse list, or a file into a pastor-approved, printable week of family discipleship: five adult devotionals (Monday to Friday), five kid versions for ages 6 to 10, one locked memory verse, small-group leader questions, a verified public-domain hymn or no song when none matches, and a coloring page, then a branded PDF. The pastor edits, checks, and approves every pack before it locks, so nothing reaches families unreviewed.

## How it works

1. The pastor pastes a sermon, picks a topic, lists verses, or uploads a file. A topic alone never makes a pack: the pastor picks the verses the week will stand on.
2. A model drafts the devotionals, guided by a retrieval bundle of public-domain commentaries, cross-references, lexicon entries, and devotional anchors for the passage. Every bundle voice carries its tradition label.
3. The pastor reviews, edits, and locks the pack. Deterministic gates check Scripture exactness and originality, and the lock hash (SHA-256) records exactly what was approved. Nothing is published until the pastor approves it.

## How AI is used

AI writes only the devotional prose, never Scripture. The model returns references only; code fills every quote character for character from a verified verse store (Berean Standard Bible, public domain), blocking publish on any mismatch. Kid versions are labeled retellings, never presented as Scripture. Hymns are verified public domain in all their parts, never modern worship lyrics. The tool does not counsel, preach, or replace a pastor: it drafts, the pastor decides.

## Backends (the pastor brings their own key)

| Backend | Cost | Notes |
|---|---|---|
| OpenRouter, GLM 5.3 Flash (`z-ai/glm-5.3-flash`) | about $0.01 a pack, measured | Recommended. Needs a card and prepaid credits at openrouter.ai. Runs on any computer. |
| Grok, grok-4.1-fast (xAI) | about $0.10 a pack | Needs a card and prepaid credits at console.x.ai. |
| Gemini, gemini-3.5-flash-lite (Google) | about $0.23 a pack | Paid option, billing set up in AI Studio. The free tier no longer works for new keys. |
| Local, Qwen3.5-4B (Apache 2.0, llama.cpp) | $0 | Runs on the pastor's own computer. Does not produce demo-grade output on its own. |
| Local, Qwen3.8-27B via mlx-serve (Mac) | $0 | Tested: built a complete pack with Scripture 5/5 exact. Needs a Mac-class machine. |

When the pastor uses OpenRouter, Grok, or Google, the sermon text is sent to that provider's API under that provider's terms. With the local model, nothing leaves the pastor's computer. The pastor chooses which backend to use. No family data is collected, and no ads run in packs.

## Run it

Flockpath is a local web app (Next.js, localhost). There is no hosted demo.

Prerequisites: Node.js 20+, Python 3.11+ (for the generation worker), Typst 0.15.1 (for the PDF builder; a bundled binary is used when present, otherwise a `typst` on PATH), and, for the local model, the Qwen3.5-4B GGUF file in `models/` (download separately, Apache 2.0).

```sh
npm install
npm run build
PORT=3210 bash local-run/start-flockpath.sh
```

Then open http://localhost:3210, sign in (a fresh email creates a clean pastor account), paste a sermon, and build a pack. Your API keys, if you enter any, are stored in the local SQLite database (`data/auth.db`), which is never committed to this repo.

## Data

- Scripture: Berean Standard Bible, dedicated to the public domain (CC0). The verse store in `data/bsb-*.json` is the single source for quotes.
- Study sources: public-domain commentaries, devotionals, dictionaries, and cross-references, with provenance pinned in the study database. Some lexicon data is CC BY 4.0 (STEPBible, Open Scriptures BDB); attribution is on the app's credits page.
- Hymns: only public domain in music, setting, words, and translation, with the setting named.
- Coloring pages: original outlines made for this project.

## License

Original code in this repository is released under the MIT License; see `LICENSE`. The Flockpath name and logo are trademarks of Dexia Digi and are not covered by that license.

## What is next (plans, not shipped)

Member mode: a Christian builds a pack for themselves, friends, and family, honestly labeled personal study, not pastor-approved, with a send-to-pastor approval bridge. More languages after that, starting with Spanish. OpenAI as a bring-your-own-key provider. None of these is built yet.

## Links

- Informational site: https://flockpath.si (the site, not the app; the app runs locally)
- Support this work: https://ko-fi.com/dexiadigi (donations)
