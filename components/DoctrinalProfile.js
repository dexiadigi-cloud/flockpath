"use client";

import { useEffect, useState } from "react";

// Nov 11, 2026, v54, Phase 4 doctrinal profile: the pastor's
// own short statement of faith, changeable here on the My
// packs page, next to the tradition setting. It steers the
// writing model for future packs, alongside the default
// guidance, and the review page flags anything that leans
// against it. It lives only in the local auth database on
// the pastor's own computer. It is never printed in a pack
// or PDF, and it is never sent anywhere except to the writing
// model the pastor already chose, as part of a pack's own
// prompts. An empty statement means the default guidance
// alone, exactly as before. Pastor-only: members build
// personal studies with the default guidance.

export default function DoctrinalProfile() {
  const [current, setCurrent] = useState("");
  const [statement, setStatement] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && typeof data.doctrinalStatement === "string") {
          setCurrent(data.doctrinalStatement);
          setStatement(data.doctrinalStatement);
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
      body: JSON.stringify({ doctrinalStatement: statement }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Could not save."); return; }
    setCurrent(data.doctrinalStatement ?? "");
    setSaved(data.message);
  }

  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>My doctrinal profile (optional)</h2>
      <p>A short statement of faith in your own words. It steers the writing model for your future packs, and review flags anything that leans against it. Leave it empty and the default guidance alone shapes your packs, exactly as before.</p>
      <p>It never appears in a pack or PDF, and it is never sent anywhere except to the writing model you already chose, as part of your pack&apos;s own prompts.</p>
      <form onSubmit={save}>
        <textarea value={statement} maxLength={2000} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. We hold to the Baptist Faith and Message: Scripture alone is our authority, salvation is by grace alone through faith alone in Christ alone." style={{ display: "block", width: "100%", minHeight: 80, padding: 8, fontSize: 15, marginBottom: 12 }} />
        <p>{statement.length}/2000 characters.</p>
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>Saved.</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }} disabled={statement === current && Boolean(saved)}>Save doctrinal profile</button>
      </form>
    </section>
  );
}
