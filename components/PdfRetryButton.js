"use client";

import { useState } from "react";

// Nov 4, 2026, PDF retry (Mac pastor-role test items 25,
// 27): a locked pack whose print PDF build failed used to
// show no PDF and no way to build one, even though the
// failure message said "retry from the pack page". This
// button lives on the pack page exactly when no PDF exists
// yet. It builds the PDF, and if the build fails again, it
// shows the build's own error detail, not a generic line,
// so the pastor (and the logs) know what actually failed.
export default function PdfRetryButton({ packId }) {
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState("");

  async function retry() {
    setState("building");
    setDetail("");
    const res = await fetch("/api/packs/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: packId }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      setState("done");
      window.location.reload();
      return;
    }
    setState("failed");
    setDetail(body.error || "The PDF build failed.");
  }

  return (
    <div style={{ border: "2px solid #c9a227", background: "#fff8e1", borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <p><strong>No print PDF yet.</strong> If a build failed, you can build it again here.</p>
      {state === "building" && <p>Building the print PDF...</p>}
      {state === "failed" && <p><strong>Build failed:</strong> {detail}</p>}
      {state !== "building" && (
        <button onClick={retry} style={{ padding: "10px 18px", fontSize: 16 }}>
          Build print PDF
        </button>
      )}
    </div>
  );
}
