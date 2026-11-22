"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Nov 20, 2026, v62, items 12, 13, 14, 16: the ONE Listen
// section for narration, used on the review page (draft) and
// the pack page (locked pack) - never built twice. It names
// the pack (title + date) so nobody narrates a stale draft by
// mistake, groups audio by day in one collapsible row per day
// (adult + kid players with durations), shows live progress
// while a background job runs, and offers per-section
// narration (adult / kid separately) plus the whole week.
//
// The status comes from GET /api/narrate?id=<draft or pack
// id>, which reads data/narration/<id>/progress.json (written
// after each file lands) and falls back to the WAV files on
// disk. The job survives leaving the page: coming back polls
// the same id and picks the status up again.

const DAY_ES = { Monday: "lunes", Tuesday: "martes", Wednesday: "miércoles", Thursday: "jueves", Friday: "viernes", Saturday: "sábado", Sunday: "domingo" };
const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function fmt(seconds) {
  const s = Math.round(Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtElapsed(startedAt, now) {
  if (!startedAt) return "";
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return String(dateStr).slice(0, 10);
  }
}

export default function NarrationListen({ narrationId, kind = "draft", packTitle = "", language = "en" }) {
  const isEs = language === "es";
  const dayName = (d) => (isEs ? (DAY_ES[d] ?? d) : d);
  const [status, setStatus] = useState(null); // GET /api/narrate payload, or null while loading
  const [loadError, setLoadError] = useState("");
  const [starting, setStarting] = useState(""); // section label of the narrate click in flight, "" when idle
  const [startError, setStartError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const pollTimer = useRef(null);

  const fetchStatus = useCallback(async () => {
    if (!narrationId) return null;
    try {
      const res = await fetch(`/api/narrate?id=${encodeURIComponent(narrationId)}`);
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { setLoadError(data.error || "Could not load narration."); return null; }
      setLoadError("");
      setStatus(data);
      return data;
    } catch {
      setLoadError("Could not load narration. Check your connection and try again.");
      return null;
    }
  }, [narrationId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const running = status?.status === "running";
  useEffect(() => {
    if (!running) return undefined;
    pollTimer.current = setInterval(() => { fetchStatus(); setNow(Date.now()); }, 5000);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [running, fetchStatus]);
  // Elapsed clock ticks every second while a job runs.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startNarration = async (section) => {
    // section: null for the whole week, or "monday-adult" /
    // "monday-kid" for one section (item 16).
    if (!narrationId || running) return;
    setStartError("");
    setStarting(section || "week");
    try {
      const res = await fetch("/api/narrate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(kind === "pack" ? { packId: narrationId } : { draftId: narrationId }), ...(section ? { section } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error || "Narration failed.");
      setStatus((prev) => ({ ...(prev ?? {}), status: "running", done: 0, total: data.total ?? prev?.total ?? 0, current: data.section ?? null, startedAt: new Date().toISOString(), error: null }));
      await fetchStatus();
    } catch (e) {
      setStartError(String(e.message || e));
    } finally {
      setStarting("");
    }
  };

  if (!narrationId) return null;
  const title = status?.title || packTitle;
  const date = status?.date ? fmtDate(status.date) : "";
  const files = status?.files ?? [];
  const byFile = new Map(files.map((f) => [f.file, f]));
  const totalSeconds = status?.totalSeconds ?? files.reduce((s, f) => s + (Number(f.seconds) || 0), 0);
  const days = (status?.days?.length ? status.days.map((d) => d.day) : [...new Set(files.map((f) => f.day))])
    .filter(Boolean)
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  const dayRows = days.length ? days : [];
  const pct = status?.total ? Math.round(((status?.done ?? 0) / status.total) * 100) : 0;
  const currentLabel = status?.current
    ? (() => { const [d, k] = String(status.current).split(" "); return `${d ? dayName(d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()) : ""}${k ? `, ${isEs ? (k === "kid" ? "niño" : "adulto") : k}` : ""}`; })()
    : "";

  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{isEs ? "Escucha este paquete" : "Listen to this pack"}</h2>
      {title ? <p><strong>{title}</strong>{date ? ` - ${date}` : ""}</p> : null}
      <p>{isEs
        ? "La narración lee en voz alta cada devocional y cada relato para niños, con la voz que elegiste en Mis paquetes. Es gratis, se hace en esta computadora y toma unos minutos para toda la semana. La primera narración descarga el modelo de voz una vez (modelo de ~311 MB, ~345 MB en total), así que un primer intento con internet lento puede fallar y necesita un reintento. El audio no está en el PDF: descárgalo abajo y compártelo con la familia."
        : "Narration reads each devotional and each kid retelling aloud, in the voice you picked in My packs. It is free, it runs on this computer, and it takes a few minutes for a whole week. The first narration downloads the voice model once (~311 MB model, ~345 MB total), so a first run on slow internet can fail and needs a retry. The audio is not in the PDF: download it below and share it with the family."}</p>
      {isEs ? (
        <p>La narración en español aún no está disponible: el modelo de voz no tiene guía de pronunciación en español, por lo que las palabras en español saldrían mal. Los paquetes en inglés se narran hoy.</p>
      ) : (
        <>
          {loadError ? <p><strong>{loadError}</strong></p> : null}
          {running ? (
            <div>
              <p><strong>{currentLabel ? `Narrating ${currentLabel}...` : "Narrating..."}</strong></p>
              <p>{status.done ?? 0} of {status.total ?? 0} done{status.startedAt ? ` - ${fmtElapsed(status.startedAt, now)} so far` : ""}. You can leave this page; the narration keeps going, and coming back here shows where it got to.</p>
              <div role="img" aria-label={`${pct}% done`} style={{ height: 12, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "#2B2E6F" }} />
              </div>
            </div>
          ) : null}
          {status?.status === "error" && status?.error ? <p><strong>{status.error}</strong></p> : null}
          {startError ? <p><strong>{startError}</strong></p> : null}
          <p>
            <button type="button" onClick={() => startNarration(null)} disabled={running || starting !== ""}>
              {starting === "week" ? "Starting narration..." : files.length ? "Narrate the whole week again" : "Narrate the whole week"}
            </button>
          </p>
          {files.length ? (
            <>
              <p>Total running time: {fmt(totalSeconds)} ({files.length} file{files.length === 1 ? "" : "s"}). <a href={`/api/narration/${encodeURIComponent(narrationId)}/zip`} download>Download the whole week</a></p>
              {dayRows.map((day) => {
                const adult = byFile.get(`${day.toLowerCase()}-adult.wav`);
                const kid = byFile.get(`${day.toLowerCase()}-kid.wav`);
                const hasAudio = Boolean(adult || kid);
                return (
                  <details key={day} open={hasAudio} style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>{dayName(day)}{hasAudio ? ` - ${fmt((Number(adult?.seconds) || 0) + (Number(kid?.seconds) || 0))}` : " - no audio yet"}</summary>
                    {["adult", "kid"].map((kindLabel) => {
                      const f = kindLabel === "adult" ? adult : kid;
                      const section = `${day.toLowerCase()}-${kindLabel}`;
                      return (
                        <div key={kindLabel} style={{ marginTop: 8 }}>
                          <p style={{ margin: "4px 0" }}>
                            <strong>{isEs ? (kindLabel === "kid" ? "niño" : "adulto") : kindLabel}</strong>
                            {f?.seconds ? ` (${fmt(f.seconds)})` : ""}
                            {" "}
                            <button type="button" onClick={() => startNarration(section)} disabled={running || starting !== ""}>
                              {starting === section ? "Starting..." : f ? "Narrate again" : "Narrate"}
                            </button>
                          </p>
                          {f ? (
                            <>
                              <audio controls preload="none" src={`/api/narration/${encodeURIComponent(narrationId)}/${f.file}`} style={{ width: "100%" }} />
                              <br />
                              <a href={`/api/narration/${encodeURIComponent(narrationId)}/${f.file}`} download={f.file}>Download</a>
                            </>
                          ) : (
                            <p style={{ margin: "4px 0" }}>No audio yet for this section.</p>
                          )}
                        </div>
                      );
                    })}
                  </details>
                );
              })}
            </>
          ) : status === null && !loadError ? (
            <p>Loading narration...</p>
          ) : !running ? (
            <p>No narration yet for this pack. Narrate one section at a time, or the whole week.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
