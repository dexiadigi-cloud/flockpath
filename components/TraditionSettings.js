"use client";

import { useEffect, useState } from "react";
import { DENOMINATIONS, denominationMessage } from "../lib/denominations.mjs";
import { useAppLanguage } from "./AppLanguage";

// Nov 2, 2026, denomination setting, changeable here on the
// My packs page. The setting is a preset, not a wall: it orders
// the voices a future pack's bundle puts first, never locks a
// pastor out of a resource, and nothing enters a pack unlabeled.
// It lives only in the local auth database on the pastor's own
// computer, never sent anywhere, never printed in a pack.

export default function TraditionSettings() {
  const { language: appLanguage, t } = useAppLanguage();
  const [current, setCurrent] = useState("");
  const [choice, setChoice] = useState("non-denominational");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.denomination) {
          setCurrent(data.denomination);
          setChoice(data.denomination);
        }
      })
      .catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    const res = await fetch("/api/me", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denomination: choice }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? t("settings.couldNotSave")); return; }
    setCurrent(data.denomination);
    setSaved(data.message);
  }

  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{t("tradition.heading")}</h2>
      <p>{t("tradition.intro")}</p>
      <form onSubmit={save}>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ padding: 8, fontSize: 15, marginBottom: 12 }}>
          {DENOMINATIONS.map((d) => (
            <option key={d.key} value={d.key}>{t(`tradition.denom.${d.key}`)}</option>
          ))}
        </select>
        <p>{denominationMessage(choice, appLanguage)}</p>
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>{t("settings.saved")}</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }} disabled={choice === current && Boolean(saved)}>{t("tradition.save")}</button>
      </form>
    </section>
  );
}
