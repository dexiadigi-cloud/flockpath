// Nov 20, 2026, v62 (item 1): the app-language setting UI.
// Lives on the My packs page, next to the tradition setting.
// The picker changes the APP's language (menus, buttons,
// headings), never a pack's language: the pack language is
// picked per pack on the Start a pack page. Saved through
// /api/me like the denomination and the narration voice, and
// stored per account in the local auth database. The page
// reloads after save, because the server-rendered shell
// (navigation, headings) reads the stored language.
"use client";

import { useEffect, useState } from "react";
import { useAppLanguage } from "./AppLanguage";
import { APP_LANGUAGE_LABELS } from "../lib/appStrings.mjs";

export default function AppLanguageSettings() {
  const { language, t, setLanguage } = useAppLanguage();
  const [choice, setChoice] = useState(language);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setChoice(language); }, [language]);

  async function save(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    const res = await fetch("/api/me", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appLanguage: choice }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Could not save."); return; }
    setLanguage(data.appLanguage || choice);
    setSaved(t("settings.saved"));
    // The navigation and headings are server-rendered from the
    // stored language, so a short pause to show the confirmation,
    // then a reload, is what actually switches the UI.
    setTimeout(() => { window.location.reload(); }, 600);
  }

  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{t("settings.appLanguage")}</h2>
      <p>{t("settings.appLanguageBody")}</p>
      <form onSubmit={save}>
        <p>
          <label><input type="radio" name="app-language" checked={choice === "en"} onChange={() => setChoice("en")} /> {APP_LANGUAGE_LABELS.en}</label>{" "}
          <label><input type="radio" name="app-language" checked={choice === "es"} onChange={() => setChoice("es")} /> {APP_LANGUAGE_LABELS.es}</label>
        </p>
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>{saved}</strong></p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }} disabled={choice === language && Boolean(saved)}>{t("settings.save")}</button>
      </form>
    </section>
  );
}
