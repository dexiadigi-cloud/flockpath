"use client";

import { useState } from "react";
import { useAppLanguage } from "./AppLanguage";

// Nov 4, 2026, signed-in password change (Mac pastor-role
// test item 3). Lives on My packs, next to the other account
// settings. Needs the current password; a pastor who cannot
// sign in at all uses the local reset script instead (see
// the forgot-password page).
export default function PasswordSettings() {
  const { t } = useAppLanguage();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    if (next !== confirm) { setError(t("password.mismatch")); return; }
    const res = await fetch("/api/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? t("password.couldNotChange")); return; }
    setCurrent("");
    setNext("");
    setConfirm("");
    setSaved(t("password.changed"));
  }

  const input = { display: "block", width: "100%", padding: 8, marginBottom: 12, fontSize: 15 };
  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{t("password.heading")}</h2>
      <p>{t("password.bodyPre")} <a href="/forgot">{t("password.bodyLink")}</a>{t("password.bodyPost")}</p>
      <form onSubmit={submit}>
        <input style={input} type="password" placeholder={t("password.currentPh")} value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input style={input} type="password" placeholder={t("password.newPh")} value={next} onChange={(e) => setNext(e.target.value)} />
        <input style={input} type="password" placeholder={t("password.newAgainPh")} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>{t("settings.saved")}</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }}>{t("password.change")}</button>
      </form>
    </section>
  );
}
