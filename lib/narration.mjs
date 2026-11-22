// Nov 20, 2026, v62, narration UX (items 12, 13, 14, 16):
// shared narration helpers, used by the narrate route, the
// file/zip serving routes, the packs list, and the lock save.
// Narration lives under data/narration/<id>/, namespaced per
// pack. A pack's id IS its draft's job id (job-<16 hex>), so
// the files a draft narrated already sit under the pack's id;
// the carry-over at lock time is that the draft JSON delete
// never touches data/narration/, the serving routes accept a
// locked library pack as the owner, and copyNarration below
// guards any future id change. No API key is involved:
// narration runs locally with the Kokoro model.

import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync } from "node:fs";
import path from "node:path";

export const NARRATION_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const NARRATION_DAY_FILES = { Monday: "monday", Tuesday: "tuesday", Wednesday: "wednesday", Thursday: "thursday", Friday: "friday", Saturday: "saturday", Sunday: "sunday" };
const FILE_TO_DAY = Object.fromEntries(Object.entries(NARRATION_DAY_FILES).map(([d, f]) => [f, d]));

export function isNarrationId(id) {
  return /^job-[0-9a-f]{16}$/.test(String(id ?? "")) || String(id ?? "") === "generated-genesis-1";
}

export function narrationDir(id) {
  return path.join(process.cwd(), "data", "narration", String(id));
}

export function parseSection(section) {
  const m = /^([a-z]+)-(adult|kid)$/.exec(String(section ?? "").trim().toLowerCase());
  if (!m) return null;
  const day = FILE_TO_DAY[m[1]];
  if (!day) return null;
  return { day, kind: m[2], file: `${m[1]}-${m[2]}.wav`, label: `${day} ${m[2]}` };
}

export function readManifest(id) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(narrationDir(id), "manifest.json"), "utf-8"));
    return { voice: manifest.voice ?? null, files: Array.isArray(manifest.files) ? manifest.files : [] };
  } catch {
    return { voice: null, files: [] };
  }
}

export function readProgress(id) {
  try {
    return JSON.parse(readFileSync(path.join(narrationDir(id), "progress.json"), "utf-8"));
  } catch {
    return null;
  }
}

// Fallback when the manifest is absent (a run that predates
// incremental manifests, or one still on its first file):
// the WAV files on disk are the progress.
export function listWavFiles(id) {
  try {
    return readdirSync(narrationDir(id))
      .filter((n) => /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-(adult|kid)\.wav$/.test(n))
      .sort()
      .map((file) => {
        const m = /^([a-z]+)-(adult|kid)\.wav$/.exec(file);
        return { day: FILE_TO_DAY[m[1]], kind: m[2], file, seconds: null };
      });
  } catch {
    return [];
  }
}

// One status read for the UI and the My packs indicator:
// "none" (nothing yet), "running", "done" (audio ready),
// "error" (failed, with the plain reason in `error`).
export function narrationStatus(id) {
  const manifest = readManifest(id);
  const progress = readProgress(id);
  const files = manifest.files.length ? manifest.files : listWavFiles(id);
  const totalSeconds = files.reduce((sum, f) => sum + (Number(f.seconds) || 0), 0);
  const done = progress && typeof progress.done === "number" ? progress.done : files.length;
  const total = progress && typeof progress.total === "number" && progress.total > 0
    ? progress.total
    : files.length;
  if (progress?.status === "running") {
    return { state: "running", files, done, total, totalSeconds, current: progress.current ?? null, startedAt: progress.startedAt ?? null, error: null, voice: manifest.voice };
  }
  if (progress?.status === "error") {
    return { state: "error", files, done, total, totalSeconds, current: null, startedAt: progress.startedAt ?? null, error: progress.error ?? "Narration failed.", voice: manifest.voice };
  }
  if (files.length) {
    return { state: "done", files, done: files.length, total: files.length, totalSeconds, current: null, startedAt: progress?.startedAt ?? null, error: null, voice: manifest.voice };
  }
  return { state: "none", files: [], done: 0, total: 0, totalSeconds: 0, current: null, startedAt: null, error: null, voice: manifest.voice };
}

export function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The pack behind a narration id, for ownership and for
// naming the pack (title + date) in the Listen section so
// nobody narrates a stale draft by mistake. A draft still
// awaiting review reads from data/drafts; a locked or
// personal pack reads from the library. Returns null when
// the id belongs to nobody, or to another account.
export function resolveNarrationSource(id, email) {
  const draftPath = path.join(process.cwd(), "data", "drafts", `${id}.json`);
  try {
    if (existsSync(draftPath)) {
      const stored = JSON.parse(readFileSync(draftPath, "utf-8"));
      if (stored.email !== email) return null;
      const pack = stored.draft ?? null;
      if (!pack) return null;
      return {
        kind: "draft", pack, title: pack.title ?? "", date: stored.createdAt ?? null,
        language: String(pack.language ?? "en").toLowerCase(),
        days: (pack.adultDevotionals ?? []).map((a, i) => ({
          day: a.day, hasAdult: true,
          hasKid: Boolean((pack.kidDevotionals ?? [])[i]),
        })),
      };
    }
  } catch { /* fall through to the library */ }
  try {
    const libPath = path.join(process.cwd(), "data", "packs-library.json");
    if (existsSync(libPath)) {
      const lib = JSON.parse(readFileSync(libPath, "utf-8"));
      const entry = lib.find((e) => e.id === id);
      if (entry && entry.email === email && entry.pack) {
        const pack = entry.pack;
        return {
          kind: "pack", pack, title: pack.title ?? entry.title ?? "", date: entry.savedAt ?? null,
          language: String(pack.language ?? "en").toLowerCase(),
          days: (pack.adultDevotionals ?? []).map((a, i) => ({
            day: a.day, hasAdult: true,
            hasKid: Boolean((pack.kidDevotionals ?? [])[i]),
          })),
        };
      }
    }
  } catch { /* no library entry */ }
  return null;
}

// Item 12 carry-over. Today the pack id is the draft job id,
// so source and destination are the same directory and this
// is a no-op by design; the files already live under the
// pack id. If the ids ever differ, the whole narration
// folder (WAVs, manifest, progress) moves with the pack.
export function copyNarration(fromId, toId) {
  if (String(fromId) === String(toId)) return { copied: false, reason: "same-id" };
  const from = narrationDir(fromId);
  const to = narrationDir(toId);
  if (!existsSync(from)) return { copied: false, reason: "no-narration" };
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  return { copied: true, reason: "copied" };
}

// A script failure line in plain words for the UI. The
// route takes the last line of the script's stderr; this
// keeps the download failure (the known first-use failure)
// in the pastor's own words, and never shows a stack.
export function plainNarrationError(detail) {
  const s = String(detail ?? "").trim().replace(/^Narration failed:\s*/i, "");
  if (!s) return "Narration failed. Try again.";
  if (/couldn't download the narration voice files/i.test(s)) {
    return "Narration failed: couldn't download the narration voice files, check your internet and try again.";
  }
  if (/Spanish narration is not available yet/i.test(s)) {
    return "Spanish narration is not available yet: the voice model has no Spanish pronunciation guide, so Spanish words would come out wrong. English packs narrate today.";
  }
  return `Narration failed: ${s.slice(-400)}`;
}
