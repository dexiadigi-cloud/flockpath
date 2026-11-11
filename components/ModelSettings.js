"use client";

import { useEffect, useState } from "react";

// Nov 5, 2026, v33 (Google API first): the writing-model setting,
// on the My packs page next to the tradition setting. Local is the
// 4B model on this computer. Google uses the pastor's own Gemini
// key from AI Studio. The key lives only in the local auth database
// on this computer, never in a pack, never in a log, and never sent
// anywhere except to Google's API. The full key is never shown back
// to the browser, only a masked hint.
//
// Nov 9, 2026, v43 (Grok API first): the pastor can also pick Grok
// (xAI), and Grok is now the recommended API option. Google's Gemini
// free tier stopped working (403, free tier not available, even for
// a fresh key), so Gemini is a paid option only. Grok is paid too
// (about $0.10 a pack on grok-4.1-fast, needs a card and prepaid
// credits at console.x.ai), but it works. The pastor brings their
// own key for whichever provider they pick: Grok, Google (paid), or
// Local (no key, the model on this computer). The setup is the same
// shape for each provider: paste the key, test it, save. The full
// key is never shown back to the browser, only a masked hint.
//
// Nov 9, 2026, v47 (OpenRouter first): the pastor can also pick
// OpenRouter, which serves GLM 5.3 Flash (z-ai/glm-5.3-flash,
// about $0.01 a pack measured Nov 9, the cheapest capable model
// found). OpenRouter is now the recommended API option: $5 of
// credits at openrouter.ai covers hundreds of packs. The setup is
// the same shape as Grok and Google: paste the key, test it, save.

export default function ModelSettings() {
  const [backend, setBackend] = useState("local");
  const [savedBackend, setSavedBackend] = useState("local");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [geminiMasked, setGeminiMasked] = useState(null);
  const [geminiInput, setGeminiInput] = useState("");
  const [hasGrokKey, setHasGrokKey] = useState(false);
  const [grokMasked, setGrokMasked] = useState(null);
  const [grokInput, setGrokInput] = useState("");
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false);
  const [openrouterMasked, setOpenRouterMasked] = useState(null);
  const [openrouterInput, setOpenRouterInput] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/model")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setBackend(data.modelBackend || "local");
          setSavedBackend(data.modelBackend || "local");
          setHasGeminiKey(Boolean(data.hasGeminiKey));
          setGeminiMasked(data.geminiKeyMasked || null);
          setHasGrokKey(Boolean(data.hasGrokKey));
          setGrokMasked(data.grokKeyMasked || null);
          setHasOpenRouterKey(Boolean(data.hasOpenRouterKey));
          setOpenRouterMasked(data.openrouterKeyMasked || null);
        }
      })
      .catch(() => {});
  }, []);

  async function testKey(kind) {
    setTestError("");
    setTestResult("");
    setSaved("");
    const key = (kind === "openrouter" ? openrouterInput : kind === "grok" ? grokInput : geminiInput).trim();
    if (!key) { setTestError("Paste a key first, then test it."); return; }
    setTesting(true);
    try {
      const body = { testKey: true };
      if (kind === "openrouter") body.openrouterApiKey = key;
      else if (kind === "grok") body.grokApiKey = key;
      else body.geminiApiKey = key;
      const res = await fetch("/api/model", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setTestError(data.error ?? "Didn't answer. Try again in a little while."); return; }
      setTestResult(data.message ?? "Your key works.");
    } finally {
      setTesting(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    setTestError("");
    const body = {};
    if (backend === "gemini") {
      if (!geminiInput.trim() && !hasGeminiKey) { setError("Paste your Google key first, then save."); return; }
      if (geminiInput.trim()) body.geminiApiKey = geminiInput.trim();
    }
    if (backend === "grok") {
      if (!grokInput.trim() && !hasGrokKey) { setError("Paste your Grok key first, then save."); return; }
      if (grokInput.trim()) body.grokApiKey = grokInput.trim();
    }
    if (backend === "openrouter") {
      if (!openrouterInput.trim() && !hasOpenRouterKey) { setError("Paste your OpenRouter key first, then save."); return; }
      if (openrouterInput.trim()) body.openrouterApiKey = openrouterInput.trim();
    }
    body.modelBackend = backend;
    const res = await fetch("/api/model", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) { setError(data.error ?? "Could not save."); return; }
    setSavedBackend(data.modelBackend);
    setHasGeminiKey(Boolean(data.hasGeminiKey));
    setGeminiMasked(data.geminiKeyMasked || null);
    setHasGrokKey(Boolean(data.hasGrokKey));
    setGrokMasked(data.grokKeyMasked || null);
    setHasOpenRouterKey(Boolean(data.hasOpenRouterKey));
    setOpenRouterMasked(data.openrouterKeyMasked || null);
    if (geminiInput.trim()) setGeminiInput("");
    if (grokInput.trim()) setGrokInput("");
    if (openrouterInput.trim()) setOpenRouterInput("");
    setSaved(
      data.modelBackend === "openrouter"
        ? "Saved. Future packs will use OpenRouter (GLM 5.3 Flash)."
        : data.modelBackend === "grok"
        ? "Saved. Future packs will use Grok (xAI)."
        : data.modelBackend === "gemini"
        ? "Saved. Future packs will use Google Gemini (paid)."
        : "Saved. Future packs will use the local model on this computer."
    );
  }

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h2 style={{ marginTop: 0 }}>Writing model</h2>
      <p>Choose what writes your packs. Local runs the model on this computer, private and offline, but it is the smaller model. OpenRouter, Grok, and Google all use a much stronger model through their service, and they work on any computer. You bring your own key for the one you pick. Change it any time; it affects future packs, never packs already locked.</p>
      <p><strong>Nothing changes until you save.</strong> Picking a provider and testing your key do not switch anything yet. Click <strong>Save writing model</strong> below to make your choice active.</p>
      <form onSubmit={save}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="radio" name="backend" checked={backend === "local"} onChange={() => setBackend("local")} /> Local, on this computer (private, offline)
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="radio" name="backend" checked={backend === "openrouter"} onChange={() => setBackend("openrouter")} /> OpenRouter (your own key, about $0.01 a pack, recommended)
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="radio" name="backend" checked={backend === "grok"} onChange={() => setBackend("grok")} /> Grok (xAI, your own key, about $0.10 a pack)
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" name="backend" checked={backend === "gemini"} onChange={() => setBackend("gemini")} /> Google Gemini (your own key, paid, about $0.23 a pack)
          </label>
        </div>
        {backend === "openrouter" && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 12 }}>
            <p><strong>Get your OpenRouter key.</strong> OpenRouter is paid, but a pack costs about $0.01, so $5 of credits covers hundreds of packs. Sign up at openrouter.ai, add credits, and make a key.</p>
            <ol>
              <li>Go to <a href="https://openrouter.ai" target="_blank" rel="noreferrer">openrouter.ai</a> and sign up with Google or email.</li>
              <li>Add credits (your profile, then <strong>Credits</strong>). $5 is plenty to start.</li>
              <li>Open <strong>Keys</strong>, then <strong>Create Key</strong>, and copy the key and paste it below.</li>
            </ol>
            <p>Your key stays on this computer only. It is never in a pack, never in a log, and never sent anywhere except to OpenRouter when a pack is written.</p>
            <label style={{ display: "block", marginBottom: 6 }}>
              OpenRouter API key
              <input
                type="password"
                value={openrouterInput}
                onChange={(e) => setOpenRouterInput(e.target.value)}
                placeholder={hasOpenRouterKey ? "A key is already saved (paste a new one to replace it)" : "Paste your key here"}
                autoComplete="off"
                style={{ display: "block", width: "100%", padding: 8, fontSize: 15, marginTop: 4 }}
              />
            </label>
            {hasOpenRouterKey && openrouterMasked && <p style={{ margin: "4px 0" }}>Saved key: <code>{openrouterMasked}</code></p>}
            <button type="button" onClick={() => testKey("openrouter")} disabled={testing} style={{ padding: "8px 14px", fontSize: 15, marginRight: 8 }}>
              {testing ? "Testing..." : "Test my key"}
            </button>
            {testResult && <span><strong>Key works.</strong> {testResult}</span>}
            {testError && <span style={{ color: "darkred" }}>{testError}</span>}
          </div>
        )}
        {backend === "grok" && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 12 }}>
            <p><strong>Get your Grok key.</strong> Grok is paid, so you will add a card and load credits at console.x.ai. A pack costs about $0.10.</p>
            <ol>
              <li>Go to <a href="https://console.x.ai" target="_blank" rel="noreferrer">console.x.ai</a> and sign in or make an account.</li>
              <li>Open <strong>API Keys</strong>, then <strong>Create API Key</strong>.</li>
              <li>Load credits (Billing) so the key can be used, then copy the key and paste it below.</li>
            </ol>
            <p>Your key stays on this computer only. It is never in a pack, never in a log, and never sent anywhere except to Grok when a pack is written.</p>
            <label style={{ display: "block", marginBottom: 6 }}>
              Grok API key
              <input
                type="password"
                value={grokInput}
                onChange={(e) => setGrokInput(e.target.value)}
                placeholder={hasGrokKey ? "A key is already saved (paste a new one to replace it)" : "Paste your key here"}
                autoComplete="off"
                style={{ display: "block", width: "100%", padding: 8, fontSize: 15, marginTop: 4 }}
              />
            </label>
            {hasGrokKey && grokMasked && <p style={{ margin: "4px 0" }}>Saved key: <code>{grokMasked}</code></p>}
            <button type="button" onClick={() => testKey("grok")} disabled={testing} style={{ padding: "8px 14px", fontSize: 15, marginRight: 8 }}>
              {testing ? "Testing..." : "Test my key"}
            </button>
            {testResult && <span><strong>Key works.</strong> {testResult}</span>}
            {testError && <span style={{ color: "darkred" }}>{testError}</span>}
          </div>
        )}
        {backend === "gemini" && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 12 }}>
            <p><strong>Get your Google key.</strong> Google&apos;s free tier no longer works for new keys, so this is a paid key. Set up billing in AI Studio first, then get the key. A pack costs about $0.23.</p>
            <ol>
              <li>Go to <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a> and sign in with your Google account.</li>
              <li>Set up billing for your project, then click <strong>Get API key</strong> and <strong>Create API key</strong>.</li>
              <li>Copy the key and paste it below.</li>
            </ol>
            <p>Your key stays on this computer only. It is never in a pack, never in a log, and never sent anywhere except to Google when a pack is written.</p>
            <label style={{ display: "block", marginBottom: 6 }}>
              Google API key
              <input
                type="password"
                value={geminiInput}
                onChange={(e) => setGeminiInput(e.target.value)}
                placeholder={hasGeminiKey ? "A key is already saved (paste a new one to replace it)" : "Paste your key here"}
                autoComplete="off"
                style={{ display: "block", width: "100%", padding: 8, fontSize: 15, marginTop: 4 }}
              />
            </label>
            {hasGeminiKey && geminiMasked && <p style={{ margin: "4px 0" }}>Saved key: <code>{geminiMasked}</code></p>}
            <button type="button" onClick={() => testKey("gemini")} disabled={testing} style={{ padding: "8px 14px", fontSize: 15, marginRight: 8 }}>
              {testing ? "Testing..." : "Test my key"}
            </button>
            {testResult && <span><strong>Key works.</strong> {testResult}</span>}
            {testError && <span style={{ color: "darkred" }}>{testError}</span>}
          </div>
        )}
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>Saved.</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }} disabled={backend === savedBackend && !geminiInput.trim() && !grokInput.trim() && !openrouterInput.trim() && Boolean(saved)}>Save writing model</button>
      </form>
    </section>
  );
}
