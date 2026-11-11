import { cookies } from "next/headers";
import { verifySession, getPastor, setModelBackend, setGeminiKey, setGrokKey, setOpenRouterKey } from "../../../lib/auth.mjs";

// Nov 5, 2026, v33 (Google API first): the writing-model setting.
// The pastor picks Local (the 4B on this computer) or Google Gemini
// (their own AI Studio key). The key lives only in the local auth
// database on the pastor's own computer. It is never in a pack,
// never in a log, and never sent anywhere except to Google's API
// when the pastor picks Gemini. The full key is never returned to
// the browser; only a masked hint.
// Nov 9, 2026, v43 (Grok API first): the pastor can also pick Grok
// (xAI, their own console.x.ai key, paid). Grok is the API going
// forward because Google's Gemini free tier stopped working (403,
// free tier not available, even for a fresh key). Gemini stays as
// a paid option. The Grok key lives only in the local auth database,
// like the Gemini key, and is never returned to the browser.

// Plain-language errors, never API codes. The key is never logged.
const ERR_BAD_KEY = "That Google key didn't work. Check the key you pasted, or get a new one from AI Studio.";
const ERR_DAILY_LIMIT = "Google is limiting how fast this pack can be built right now. Wait a minute, then test again, or switch to Grok or the local model for this pack.";
const ERR_GOOGLE_BUSY = "Google didn't answer. Try again in a little while.";
const ERR_GROK_BAD_KEY = "That Grok key didn't work. Check the key you pasted, or get a new one from console.x.ai.";
const ERR_GROK_BUSY = "Grok didn't answer. Try again in a little while.";
const ERR_OPENROUTER_BAD_KEY = "That OpenRouter key didn't work. Check the key you pasted, or get a new one from openrouter.ai.";
const ERR_OPENROUTER_NO_CREDITS = "Your OpenRouter account is out of credits. Add credits at openrouter.ai, then test again.";
const ERR_OPENROUTER_BUSY = "OpenRouter didn't answer. Try again in a little while.";

async function testGeminiKey(apiKey) {
  const key = String(apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Paste a key first." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with the single word OK and nothing else." }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20 },
        }),
        signal: controller.signal,
      }
    );
    if (res.status === 400) return { ok: false, error: ERR_BAD_KEY };
    if (res.status === 403) return { ok: false, error: "Google says the free tier is not available for this key's project. Set up billing in AI Studio to use Gemini, or switch to Grok or the local model." };
    if (res.status === 429) return { ok: false, error: ERR_DAILY_LIMIT };
    if (!res.ok) return { ok: false, error: ERR_GOOGLE_BUSY };
    const data = await res.json().catch(() => ({}));
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, error: ERR_GOOGLE_BUSY };
    return { ok: true, message: "Your key works. Google answered." };
  } catch {
    return { ok: false, error: ERR_GOOGLE_BUSY };
  } finally {
    clearTimeout(timer);
  }
}

async function testGrokKey(apiKey) {
  const key = String(apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Paste a key first." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      "https://api.x.ai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "grok-4.1-fast",
          messages: [{ role: "user", content: "Reply with the single word OK and nothing else." }],
          temperature: 0,
          max_tokens: 20,
        }),
        signal: controller.signal,
      }
    );
    if (res.status === 401) return { ok: false, error: ERR_GROK_BAD_KEY };
    if (res.status === 429) return { ok: false, error: "Grok is limiting how fast requests can be made right now. Wait a minute, then test again." };
    if (!res.ok) return { ok: false, error: ERR_GROK_BUSY };
    const data = await res.json().catch(() => ({}));
    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { ok: false, error: ERR_GROK_BUSY };
    return { ok: true, message: "Your key works. Grok answered." };
  } catch {
    return { ok: false, error: ERR_GROK_BUSY };
  } finally {
    clearTimeout(timer);
  }
}

async function testOpenRouterKey(apiKey) {
  const key = String(apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Paste a key first." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "z-ai/glm-5.3-flash",
          messages: [{ role: "user", content: "Reply with the single word OK and nothing else." }],
          temperature: 0,
          max_tokens: 100,
          reasoning: { effort: "low" },
        }),
        signal: controller.signal,
      }
    );
    if (res.status === 401) return { ok: false, error: ERR_OPENROUTER_BAD_KEY };
    if (res.status === 402) return { ok: false, error: ERR_OPENROUTER_NO_CREDITS };
    if (res.status === 429) return { ok: false, error: "OpenRouter is limiting how fast requests can be made right now. Wait a minute, then test again." };
    if (!res.ok) return { ok: false, error: ERR_OPENROUTER_BUSY };
    const data = await res.json().catch(() => ({}));
    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { ok: false, error: ERR_OPENROUTER_BUSY };
    return { ok: true, message: "Your key works. OpenRouter answered." };
  } catch {
    return { ok: false, error: ERR_OPENROUTER_BUSY };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const pastor = getPastor(s.email);
  if (!pastor) return Response.json({ ok: false, error: "Pastor not found." }, { status: 404 });
  return Response.json({
    ok: true,
    modelBackend: pastor.modelBackend,
    hasGeminiKey: pastor.hasGeminiKey,
    geminiKeyMasked: pastor.geminiKeyMasked,
    hasGrokKey: pastor.hasGrokKey,
    grokKeyMasked: pastor.grokKeyMasked,
    hasOpenRouterKey: pastor.hasOpenRouterKey,
    openrouterKeyMasked: pastor.openrouterKeyMasked,
  });
}

export async function POST(request) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    // Test a key the pastor just pasted, with one small call. Testing
    // does not save anything. The saved key is never sent to the
    // browser, so it is tested by pasting it again, not from storage.
    if (body.testKey) {
      if (typeof body.openrouterApiKey === "string") {
        const keyToTest = body.openrouterApiKey.trim();
        if (!keyToTest) {
          return Response.json({ ok: false, error: "Paste a key first, then test it." }, { status: 400 });
        }
        return Response.json(await testOpenRouterKey(keyToTest));
      }
      if (typeof body.grokApiKey === "string") {
        const keyToTest = body.grokApiKey.trim();
        if (!keyToTest) {
          return Response.json({ ok: false, error: "Paste a key first, then test it." }, { status: 400 });
        }
        return Response.json(await testGrokKey(keyToTest));
      }
      const keyToTest = typeof body.geminiApiKey === "string" ? body.geminiApiKey.trim() : "";
      if (!keyToTest) {
        return Response.json({ ok: false, error: "Paste a key first, then test it." }, { status: 400 });
      }
      return Response.json(await testGeminiKey(keyToTest));
    }
    let pastor = getPastor(s.email);
    if (!pastor) return Response.json({ ok: false, error: "Pastor not found." }, { status: 404 });
    if (typeof body.geminiApiKey === "string") {
      pastor = setGeminiKey(s.email, body.geminiApiKey);
    }
    if (typeof body.grokApiKey === "string") {
      pastor = setGrokKey(s.email, body.grokApiKey);
    }
    if (typeof body.openrouterApiKey === "string") {
      pastor = setOpenRouterKey(s.email, body.openrouterApiKey);
    }
    if (typeof body.modelBackend === "string") {
      if (body.modelBackend === "gemini" && !pastor.hasGeminiKey && typeof body.geminiApiKey !== "string") {
        return Response.json({ ok: false, error: "Save a Google key first, then switch to Google." }, { status: 400 });
      }
      if (body.modelBackend === "grok" && !pastor.hasGrokKey && typeof body.grokApiKey !== "string") {
        return Response.json({ ok: false, error: "Save a Grok key first, then switch to Grok." }, { status: 400 });
      }
      if (body.modelBackend === "openrouter" && !pastor.hasOpenRouterKey && typeof body.openrouterApiKey !== "string") {
        return Response.json({ ok: false, error: "Save an OpenRouter key first, then switch to OpenRouter." }, { status: 400 });
      }
      pastor = setModelBackend(s.email, body.modelBackend);
    }
    return Response.json({
      ok: true,
      modelBackend: pastor.modelBackend,
      hasGeminiKey: pastor.hasGeminiKey,
      geminiKeyMasked: pastor.geminiKeyMasked,
      hasGrokKey: pastor.hasGrokKey,
      grokKeyMasked: pastor.grokKeyMasked,
      hasOpenRouterKey: pastor.hasOpenRouterKey,
      openrouterKeyMasked: pastor.openrouterKeyMasked,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message ?? "Could not save." }, { status: 400 });
  }
}
