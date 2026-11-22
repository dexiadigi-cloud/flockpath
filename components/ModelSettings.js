"use client";

import { useEffect, useState } from "react";
import { useAppLanguage } from "./AppLanguage";

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
//
// Nov 17, 2026, v58 (OpenRouter OAuth sign-in, PKCE): the pastor
// can also sign in with OpenRouter instead of pasting a key. The
// button goes to /api/model/openrouter-oauth?start=1, which
// redirects to openrouter.ai/auth; OpenRouter sends them back,
// the server exchanges the code for a key, and stores it exactly
// where a pasted key goes. The paste flow below stays untouched
// as the fallback. Sign-in only removes the key-pasting step:
// the pastor still needs an OpenRouter account and paid credits
// (see the credits note in the OpenRouter section). The full key
// is never shown back to the browser, only a masked hint.

export default function ModelSettings() {
  const { t } = useAppLanguage();
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
  const [oauthNote, setOauthNote] = useState("");
  const [oauthError, setOauthError] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Nov 17, 2026, v58: the OAuth callback lands back on
    // /packs with ?openrouter=connected (or denied / error).
    // Read it once, show it, then clean the URL so a refresh
    // does not repeat the message.
    const q = new URLSearchParams(window.location.search);
    const flag = q.get("openrouter");
    if (flag === "connected") {
      setOauthNote(t("model.oauthConnected"));
    } else if (flag === "denied") {
      setOauthError(t("model.oauthDenied"));
    } else if (flag === "error") {
      const reason = q.get("reason");
      setOauthError(
        reason === "expired"
          ? t("model.oauthExpired")
          : t("model.oauthError")
      );
    }
    if (flag) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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
    if (!key) { setTestError(t("model.needKeyFirst")); return; }
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
      if (!res.ok || !data.ok) { setTestError(data.error ?? t("model.testNoAnswer")); return; }
      setTestResult(data.message ?? t("model.keyWorks"));
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
      if (!geminiInput.trim() && !hasGeminiKey) { setError(t("model.needGeminiKey")); return; }
      if (geminiInput.trim()) body.geminiApiKey = geminiInput.trim();
    }
    if (backend === "grok") {
      if (!grokInput.trim() && !hasGrokKey) { setError(t("model.needGrokKey")); return; }
      if (grokInput.trim()) body.grokApiKey = grokInput.trim();
    }
    if (backend === "openrouter") {
      if (!openrouterInput.trim() && !hasOpenRouterKey) { setError(t("model.needOpenRouterKey")); return; }
      if (openrouterInput.trim()) body.openrouterApiKey = openrouterInput.trim();
    }
    body.modelBackend = backend;
    const res = await fetch("/api/model", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) { setError(data.error ?? t("settings.couldNotSave")); return; }
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
    // Nov 21, 2026, v63 round 2: the saved line used to
    // carry its own "Saved. " prefix, which doubled with
    // the "Saved." the render already prints in front of
    // it. The strings below are the part after "Saved." now.
    setSaved(
      data.modelBackend === "openrouter"
        ? t("model.savedOpenRouter")
        : data.modelBackend === "grok"
        ? t("model.savedGrok")
        : data.modelBackend === "gemini"
        ? t("model.savedGemini")
        : t("model.savedLocal")
    );
  }

  return (
    <section className="fp-card">
      <h2 style={{ marginTop: 0 }}>{t("model.heading")}</h2>
      <p>{t("model.intro")}</p>
      <p><strong>{t("model.saveNoteBold")}</strong> {t("model.saveNotePre")} <strong>{t("model.save")}</strong> {t("model.saveNotePost")}</p>
      <form onSubmit={save}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="radio" name="backend" checked={backend === "local"} onChange={() => setBackend("local")} /> {t("model.providerLocal")}
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="radio" name="backend" checked={backend === "openrouter"} onChange={() => setBackend("openrouter")} /> {t("model.providerOpenRouter")}
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="radio" name="backend" checked={backend === "grok"} onChange={() => setBackend("grok")} /> {t("model.providerGrok")}
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" name="backend" checked={backend === "gemini"} onChange={() => setBackend("gemini")} /> {t("model.providerGemini")}
          </label>
        </div>
        {backend === "openrouter" && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 12 }}>
            <p><strong>{t("model.orGetKey")}</strong> {t("model.orIntro")}</p>
            <p>
              <a href="/api/model/openrouter-oauth?start=1" style={{ display: "inline-block", padding: "8px 14px", fontSize: 15, border: "1px solid #2B2E6F", borderRadius: 6, textDecoration: "none" }}>
                {t("model.signInOr")}
              </a>
            </p>
            <p style={{ marginTop: 4 }}>{t("model.signInNote")}</p>
            {oauthNote && <p><strong>{t("model.signedInPrefix")}</strong> {oauthNote}</p>}
            {oauthError && <p style={{ color: "darkred" }}>{oauthError}</p>}
            <p><strong>{t("model.creditsHeading")}</strong> {t("model.creditsBody")}</p>
            <ol>
              <li>{t("model.orStep1Pre")} <a href="https://openrouter.ai" target="_blank" rel="noreferrer">openrouter.ai</a> {t("model.orStep1Post")}</li>
              <li>{t("model.orStep2Pre")} <strong>Credits</strong>{t("model.orStep2Post")}</li>
              <li>{t("model.orStep3Pre")} <strong>Keys</strong>{t("model.orStep3Then")} <strong>Create Key</strong>{t("model.orStep3Post")}</li>
            </ol>
            <p>{t("model.keyStaysOpenRouter")}</p>
            <p><strong>{t("model.orPasteInstead")}</strong></p>
            <label style={{ display: "block", marginBottom: 6 }}>
              {t("model.orKeyLabel")}
              <input
                type="password"
                value={openrouterInput}
                onChange={(e) => setOpenRouterInput(e.target.value)}
                placeholder={hasOpenRouterKey ? t("model.keyPlaceholderSaved") : t("model.keyPlaceholderEmpty")}
                autoComplete="off"
                style={{ display: "block", width: "100%", padding: 8, fontSize: 15, marginTop: 4 }}
              />
            </label>
            {hasOpenRouterKey && openrouterMasked && <p style={{ margin: "4px 0" }}>{t("model.savedKey")} <code>{openrouterMasked}</code></p>}
            <button type="button" onClick={() => testKey("openrouter")} disabled={testing} style={{ padding: "8px 14px", fontSize: 15, marginRight: 8 }}>
              {testing ? t("model.testing") : t("model.testKey")}
            </button>
            {testResult && <span><strong>{t("model.keyWorks")}</strong> {testResult}</span>}
            {testError && <span style={{ color: "darkred" }}>{testError}</span>}
          </div>
        )}
        {backend === "grok" && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 12 }}>
            <p><strong>{t("model.grokGetKey")}</strong> {t("model.grokIntro")}</p>
            <ol>
              <li>{t("model.grokStep1Pre")} <a href="https://console.x.ai" target="_blank" rel="noreferrer">console.x.ai</a> {t("model.grokStep1Post")}</li>
              <li>{t("model.grokStep2Pre")} <strong>API Keys</strong>{t("model.grokStep2Then")} <strong>Create API Key</strong>.</li>
              <li>{t("model.grokStep3")}</li>
            </ol>
            <p>{t("model.keyStaysGrok")}</p>
            <label style={{ display: "block", marginBottom: 6 }}>
              {t("model.grokKeyLabel")}
              <input
                type="password"
                value={grokInput}
                onChange={(e) => setGrokInput(e.target.value)}
                placeholder={hasGrokKey ? t("model.keyPlaceholderSaved") : t("model.keyPlaceholderEmpty")}
                autoComplete="off"
                style={{ display: "block", width: "100%", padding: 8, fontSize: 15, marginTop: 4 }}
              />
            </label>
            {hasGrokKey && grokMasked && <p style={{ margin: "4px 0" }}>{t("model.savedKey")} <code>{grokMasked}</code></p>}
            <button type="button" onClick={() => testKey("grok")} disabled={testing} style={{ padding: "8px 14px", fontSize: 15, marginRight: 8 }}>
              {testing ? t("model.testing") : t("model.testKey")}
            </button>
            {testResult && <span><strong>{t("model.keyWorks")}</strong> {testResult}</span>}
            {testError && <span style={{ color: "darkred" }}>{testError}</span>}
          </div>
        )}
        {backend === "gemini" && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 12 }}>
            <p><strong>{t("model.geminiGetKey")}</strong> {t("model.geminiIntro")}</p>
            <ol>
              <li>{t("model.geminiStep1Pre")} <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a> {t("model.geminiStep1Post")}</li>
              <li>{t("model.geminiStep2Pre")} <strong>Get API key</strong> {t("model.geminiStep2Then")} <strong>Create API key</strong>{t("model.geminiStep2Post")}</li>
              <li>{t("model.geminiStep3")}</li>
            </ol>
            <p>{t("model.keyStaysGemini")}</p>
            <label style={{ display: "block", marginBottom: 6 }}>
              {t("model.geminiKeyLabel")}
              <input
                type="password"
                value={geminiInput}
                onChange={(e) => setGeminiInput(e.target.value)}
                placeholder={hasGeminiKey ? t("model.keyPlaceholderSaved") : t("model.keyPlaceholderEmpty")}
                autoComplete="off"
                style={{ display: "block", width: "100%", padding: 8, fontSize: 15, marginTop: 4 }}
              />
            </label>
            {hasGeminiKey && geminiMasked && <p style={{ margin: "4px 0" }}>{t("model.savedKey")} <code>{geminiMasked}</code></p>}
            <button type="button" onClick={() => testKey("gemini")} disabled={testing} style={{ padding: "8px 14px", fontSize: 15, marginRight: 8 }}>
              {testing ? t("model.testing") : t("model.testKey")}
            </button>
            {testResult && <span><strong>{t("model.keyWorks")}</strong> {testResult}</span>}
            {testError && <span style={{ color: "darkred" }}>{testError}</span>}
          </div>
        )}
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        {saved && <p><strong>{t("settings.saved")}</strong> {saved}</p>}
        <button style={{ padding: "10px 18px", fontSize: 15 }} disabled={backend === savedBackend && !geminiInput.trim() && !grokInput.trim() && !openrouterInput.trim() && Boolean(saved)}>{t("model.save")}</button>
      </form>
    </section>
  );
}
