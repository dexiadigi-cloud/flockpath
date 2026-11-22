"use client";
import { useEffect, useRef, useState } from "react";
import { useAppLanguage } from "./AppLanguage";
import { t } from "../lib/appStrings.mjs";

// Nov 11, 2026, v54, Phase 4 audio narration: the pastor's
// picked narration voice, one of the nine fixed English
// voices from the Kokoro model the app ships. No voice
// cloning: the voice is a fixed choice, never a recording
// of anyone. The voice is used only by the narration step,
// on this computer, and is never sent anywhere. Spanish
// packs do not narrate yet: the voice model has no Spanish
// pronunciation guide, so Spanish words would come out
// wrong.
// Nov 20, 2026, v61: the lineup is eight male voices plus
// Heart as the one female voice, with Liam as the default
// (Jeremiah's pick from the previews). Each voice has a
// play button that plays its staged sample from
// public/narration-previews, so the pastor hears a voice
// before picking it. The samples ship with the tool.
// Nov 21, 2026, v62: the default is now "Liam & Echo", the
// 50/50 Liam+Echo blend (test set 3 #2, Jeremiah's pick),
// and the first-use download is the fp32 model (~311 MB
// model, ~345 MB total). The play button carries a visible
// play icon and a dark text color: globals.css sets every
// button to white text, and a white-on-white play button
// was invisible on his Mac in v61.
// Nov 21, 2026, v63: the chrome reads in the app language.
// Voice NAMES (Liam, Echo, Adam, Heart...) are proper nouns
// and stay as-is; only the descriptors (male, female, warm,
// default) translate, via narration.* keys.
const VOICES = [
  { value: "am_liam_echo", name: "Liam & Echo", tags: ["male"], isDefault: true },
  { value: "am_liam", name: "Liam", tags: ["male"] },
  { value: "am_adam", name: "Adam", tags: ["male"] },
  { value: "am_echo", name: "Echo", tags: ["male"] },
  { value: "am_eric", name: "Eric", tags: ["male"] },
  { value: "am_fenrir", name: "Fenrir", tags: ["male"] },
  { value: "am_michael", name: "Michael", tags: ["male"] },
  { value: "am_onyx", name: "Onyx", tags: ["male"] },
  { value: "am_puck", name: "Puck", tags: ["male"] },
  { value: "af_heart", name: "Heart", tags: ["warm", "female"] },
];

export default function NarrationSettings() {
  const { language: appLanguage } = useAppLanguage();
  const [voice, setVoice] = useState("am_liam_echo");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok && d.narrationVoice) setVoice(d.narrationVoice); }).catch(() => {});
  }, []);
  useEffect(() => {
    return () => { if (audioRef.current) audioRef.current.pause(); };
  }, []);
  function voiceLabel(v) {
    const desc = v.tags.map((tag) => t(appLanguage, `narration.${tag}`)).join(", ");
    return `${v.name} - ${desc}${v.isDefault ? ` (${t(appLanguage, "narration.default")})` : ""}`;
  }
  function playPreview(value) {
    if (playing === value) {
      if (audioRef.current) audioRef.current.pause();
      setPlaying(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(`/narration-previews/preview-${value}.wav`);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    audio.onerror = () => setPlaying(null);
    setPlaying(value);
    audio.play().catch(() => setPlaying(null));
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true); setMessage("");
    const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrationVoice: voice }) });
    const d = await r.json().catch(() => ({}));
    setMessage(d.ok ? (d.message || t(appLanguage, "narration.saved")) : (d.error || t(appLanguage, "narration.saveFailed")));
    setBusy(false);
  }
  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{t(appLanguage, "narration.heading")}</h2>
      <p>{t(appLanguage, "narration.intro")}</p>
      <p>{t(appLanguage, "narration.firstDownload")}</p>
      <form onSubmit={save}>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t(appLanguage, "narration.legend")}</legend>
          {VOICES.map((v) => (
            <label key={v.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <input type="radio" name="narration-voice" value={v.value} checked={voice === v.value} onChange={() => setVoice(v.value)} />
              <span style={{ flex: 1 }}>{voiceLabel(v)}</span>
              <button type="button" onClick={() => playPreview(v.value)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #333", background: "#fff", color: "#111", cursor: "pointer" }}>{playing === v.value ? `■ ${t(appLanguage, "narration.stop")}` : `▶ ${t(appLanguage, "narration.play")}`}</button>
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={busy} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#fff", cursor: "pointer" }}>{busy ? t(appLanguage, "narration.saving") : t(appLanguage, "narration.saveVoice")}</button>
        {message ? <p style={{ marginTop: 8 }}>{message}</p> : null}
      </form>
    </section>
  );
}
