# Flockpath local run

Flockpath runs on your own computer, in your browser. It is not a
website you sign into, and it is not a desktop app yet. You start
it, it opens at http://localhost:3000, and you stop it when you
are done. Your sermon text, your packs, and your church name stay
on your computer.

## Install first (one time only)

- Node.js 20 or newer (https://nodejs.org). This gives you `node`
  and `npm`.
- Python 3.11 or newer (https://www.python.org). Then install
  two Python packages, in a terminal:
  - Mac (Homebrew Python blocks plain pip installs, so the
    extra flag is needed): `python3 -m pip install --break-system-packages llama-cpp-python pypdf`
  - Linux: `python3 -m pip install llama-cpp-python pypdf`
  - Windows: `python -m pip install llama-cpp-python pypdf`
  (llama-cpp-python runs the model; pypdf reads uploaded PDFs.)
- About 2.5 GB free disk: about 1.8 GB for the model, plus the app
  and your packs. A computer with at least 8 GB of memory is
  recommended; generation is slower on less memory.

## Start

- Mac: double-click `start-flockpath.command`. The first time, your
  Mac may ask you to allow it. If double-clicking does not work,
  open Terminal in this folder and run `bash start-flockpath.sh`.
- Windows: double-click `start-flockpath.bat`.
- Linux: run `bash start-flockpath.sh`.

The first start finds or downloads the model, checks its hash,
installs app packages, and builds the app. Later starts are fast
because all of that is cached. Your browser opens at
http://localhost:3000. If it does not open by itself, type that
address into your browser.

### The model: no re-download if you already have it

The app runs one exact model file:
`Qwen3.5-4B-S-TS-Q4_K_S.gguf` from TheStageAI. Before downloading
anything, the start script looks for a copy you already have: a
`FLOCKPATH_MODEL` path you point it at wins, otherwise it searches
`~/flockpath-4b`, `~/models`, `~/Downloads`, and the HuggingFace
caches, and reuses the first file whose hash matches. Only if
nothing verified is found does it download the 1.8 GB file, once.
If you point at a file and its hash does not match, the script
stops instead of silently downloading over your choice: a
different file is a different model.

## Stop

- Mac/Linux: press Ctrl+C in the Terminal window. That stops both
  the app and the generation worker.
- Windows: close the window, then double-click
  `stop-flockpath.bat` to stop the worker.

## A first run, step by step

1. Sign in or create a local account on the sign-in page. This
   account lives only on your computer.
2. On the input page, paste a sermon, type a topic, or list 5
   verses. Use "Search topic in Phos" if you start from a topic,
   check the verses you want, and confirm them.
3. Click Generate. The job is recorded, and the worker generates
   a draft. Generation takes a range, not a fixed time: the app
   shows 30 to 90 minutes on a typical machine. A fast Mac may
   beat that range. Do not close the window while it runs. While
   it runs, the input page shows the current step, like Step 6
   of 14: Building Wednesday, and refreshes on its own. The
   draft appears for review when it is ready.
4. On the review page, read every section. Edit anything that is
   wrong. The quality gates flag problems; a flagged pack cannot
   be locked until you fix or accept what is flagged. You can
   swap the hymn and the coloring page.
5. Only when you are happy, click Approve and Lock. That creates
   the finished pack, its PDF, and its share page. Nothing is
   published before you lock it.
6. Download the print PDF (Letter) from the pack page and print
   it, or send the PDF from your own email or chat app.

## Updates: over your install, never a reinstall

When a new version arrives as `flockpath-update-*.zip`, put it
next to `update-flockpath.command` (or in Downloads) and
double-click `update-flockpath.command`. It stops the app if it
is running, backs up the current code, replaces the code and
shipped data, rebuilds the app, and starts the app again if it
was running. It never touches your accounts, library, drafts,
jobs, models, church logos, pack PDFs, or logs, and it never
re-downloads the model. If an update fails, the previous version
is restored automatically. To go back by hand, run
`bash update-flockpath.sh --rollback`. Backups live next to the
app as `flockpath-backup-<version>-<date>`.

## Logs: three files to send when something goes wrong

Every start writes three daily logs in `flockpath/data/logs/`:
`app-<date>.log` (the web server), `worker-<date>.log`
(generation), and `start-<date>.log` (install and startup
steps). Updates add `update-<date>.log`. Logs older than 7 days
are deleted automatically on every start and update.
`data/worker.log` is a link to today's worker log. To bundle the
logs for sending, double-click `collect-logs.command` next to
the updater; it writes `flockpath-logs-<date>.zip` in the same
folder.

## If something goes wrong

- "Node.js is not installed" or "Python is not installed": install
  from the links above, close the terminal, and start again.
- "Model hash does not match": delete the file
  `models/Qwen3.5-4B-S-TS-Q4_K_S.gguf` and start again to
  re-download it.
- "Port 3000 is already in use": stop the other app on port 3000,
  or start with `PORT=3001 bash start-flockpath.sh` (Mac/Linux).
- Generation stuck for a long time: check `data/worker.log` for
  the last lines. A job left running by a stopped worker can be
  continued from the app; it does not silently restart from
  scratch.
- App failed to start: the error is in
  `data/logs/app-<today>.log`; startup failures are in
  `data/logs/start-<today>.log`. Bundle both with
  `collect-logs.command` and send the zip.

## Honest limits, Nov 3, 2026

- The Mac start script and the Windows start script are UNTESTED
  on a Mac and on Windows. They were tested on Linux. Run them
  once and report any error line before a pastor uses them.
  The Mac package already carries the Mac fixes (a shipped Phos
  database, the Hymn Desk sibling, a macOS Typst binary, model
  reuse, the updater, and the logs); the first Mac run is what
  proves them.
- This is not an Electron desktop app. A true desktop app needs
  a Mac build and signing, which cannot be verified from Linux.
  The browser version above is what pastors test first.
- Generation needs the model on your computer. The app never
  sends your sermon or your packs to a server to generate them.
