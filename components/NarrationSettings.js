"use client";
import { useEffect, useState } from "react";

// Nov 11, 2026, v54, Phase 4 audio narration: the pastor's
// picked narration voice, one of four fixed English voices
// from the Kokoro model the app ships. No voice cloning:
// the voice is a fixed choice, never a recording of anyone.
// The voice is used only by the narration step, on this
// computer, and is never sent anywhere. Spanish packs do not
// narrate yet: the voice model has no Spanish pronunciation
// guide, so Spanish words would come out wrong.
const VOICES = [
  { value: "af_heart", label: "Heart - warm, female (default)" },
  { value: "af_bella", label: "Bella - female" },
  { value: "am_adam", label: "Adam - male" },
  { value: "am_michael", label: "Michael - male" },
];

export default function NarrationSettings() {
  const [voice, setVoice] = useState("af_heart");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok && d.narrationVoice) setVoice(d.narrationVoice); }).catch(() => {});
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true); setMessage("");
    const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrationVoice: voice }) });
    const d = await r.json().catch(() => ({}));
    setMessage(d.ok ? (d.message || "Saved.") : (d.error || "Could not save."));
    setBusy(false);
  }
  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>Narration voice</h2>
      <p>The voice that reads a pack aloud, when you ask for narration on the review page. One fixed voice per pack; no voice cloning, and the voice is never sent anywhere. English packs only for now: Spanish narration is not available yet, because the voice model has no Spanish pronunciation guide.</p>
      <form onSubmit={save}>
        <label style={{ display: "block", marginBottom: 12 }}>
          Voice
          <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}>
            {VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#fff", cursor: "pointer" }}>{busy ? "Saving..." : "Save voice"}</button>
        {message ? <p style={{ marginTop: 8 }}>{message}</p> : null}
      </form>
    </section>
  );
}
