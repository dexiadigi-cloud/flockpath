"use client";

import { useEffect, useState } from "react";
import { useAppLanguage } from "./AppLanguage";
import { tf } from "../lib/appStrings.mjs";

// Nov 3, 2026, church logo setting, changeable here on the
// My packs page. The logo is the church's own branding: it
// prints on future pack covers, above the pack title, and
// nowhere else. It lives only on the pastor's own computer,
// in public/church-logos and on the pastor row. Changing it
// affects future packs, never packs already locked.

// Nov 5, 2026, round-2 logo fix: a logo uploaded while
// the server runs 404s through a static public/ URL,
// because the production server snapshots public/ at
// startup. The preview now goes through the file-serving
// route, which reads the file from disk. Sample
// thumbnails stay static: they ship with the app and
// already exist at startup.
function logoUrl(stored) {
  if (!stored) return null;
  const file = String(stored).split("/").pop();
  return `/api/packs/pdf-file?kind=logo&file=${encodeURIComponent(file)}`;
}

export default function ChurchLogoSettings() {
  const { language: appLanguage, t } = useAppLanguage();
  const [current, setCurrent] = useState(null);
  const [file, setFile] = useState(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [samplePick, setSamplePick] = useState("");

  // Nov 9, 2026, v49: the sample logos are now a dropdown, so a
  // pastor picks one in a single select instead of two image
  // cards. Picking one copies it as the logo right away.
  const SAMPLES = [
    { file: "sample-church.png", label: "SC monogram" },
    { file: "sample-church-cross-v2.png", label: "Cross, Sample Church" },
  ];

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.logo) setCurrent(logoUrl(data.logo));
      })
      .catch(() => {});
  }, []);

  async function upload(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    if (!file) { setError(t("logo.chooseFirst")); return; }
    const form = new FormData();
    form.append("logo", file);
    const res = await fetch("/api/logo", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? t("logo.couldNotSave")); return; }
    setCurrent(logoUrl(data.logo));
    setSaved(t("logo.saved"));
  }

  async function remove() {
    setError("");
    setSaved("");
    const form = new FormData();
    form.append("remove", "1");
    const res = await fetch("/api/logo", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? t("logo.couldNotRemove")); return; }
    setCurrent(null);
    setFile(null);
    setSaved(t("logo.removed"));
  }

  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{t("logo.heading")}</h2>
      <p>{t("logo.intro")}</p>
      {current && (
        <p>
          {t("logo.current")} <img src={current} alt={t("logo.currentAlt")} style={{ maxWidth: 120, maxHeight: 120, verticalAlign: "middle", marginLeft: 8 }} />
        </p>
      )}
      <form onSubmit={upload}>
        <input type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "block", marginBottom: 12 }} />
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>{t("settings.saved")}</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15, marginRight: 8 }}>{t("logo.save")}</button>
        {current && <button type="button" style={{ padding: "10px 18px", fontSize: 15 }} onClick={remove}>{t("logo.remove")}</button>}
      </form>
      <h3 style={{ marginTop: 20 }}>{t("logo.sampleHeading")}</h3>
      <p>{t("logo.sampleIntro")}</p>
      <label style={{ display: "block", marginBottom: 8 }}>
        {t("logo.sampleLabel")}
        <select
          value={samplePick}
          onChange={async (e) => {
            const picked = e.target.value;
            setSamplePick(picked);
            if (!picked) return;
            setError("");
            setSaved("");
            const form = new FormData();
            form.append("sample", picked);
            const res = await fetch("/api/logo", { method: "POST", body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setError(data.error ?? t("logo.couldNotSample")); return; }
            setCurrent(logoUrl(data.logo));
            setSaved(tf(appLanguage, "logo.sampleSet", { label: SAMPLES.find((s) => s.file === picked)?.label }));
          }}
          style={{ display: "block", marginTop: 4, padding: "8px 10px", fontSize: 15, minWidth: 260 }}
        >
          <option value="">{t("logo.chooseSample")}</option>
          {SAMPLES.map((s) => (
            <option key={s.file} value={s.file}>{s.label}</option>
          ))}
        </select>
      </label>
      {samplePick && (
        <p>
          {t("logo.preview")} <img src={`/church-logos/${samplePick}`} alt={t("logo.previewAlt")} style={{ maxWidth: 120, maxHeight: 120, verticalAlign: "middle", marginLeft: 8 }} />
        </p>
      )}
    </section>
  );
}
