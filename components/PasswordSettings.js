"use client";

import { useState } from "react";

// Nov 4, 2026, signed-in password change (Mac pastor-role
// test item 3). Lives on My packs, next to the other account
// settings. Needs the current password; a pastor who cannot
// sign in at all uses the local reset script instead (see
// the forgot-password page).
export default function PasswordSettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    if (next !== confirm) { setError("The two new passwords do not match."); return; }
    const res = await fetch("/api/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "Could not change password."); return; }
    setCurrent("");
    setNext("");
    setConfirm("");
    setSaved("Password changed. Use the new password next time you sign in.");
  }

  const input = { display: "block", width: "100%", padding: 8, marginBottom: 12, fontSize: 15 };
  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h2 style={{ marginTop: 0 }}>Password</h2>
      <p>Demo-version rule: at least 8 characters. A future version will ask for more. If you cannot sign in at all, use the reset script on the <a href="/forgot">forgot-password page</a> instead.</p>
      <form onSubmit={submit}>
        <input style={input} type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input style={input} type="password" placeholder="New password, at least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
        <input style={input} type="password" placeholder="New password again" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>Saved.</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }}>Change password</button>
      </form>
    </section>
  );
}
