import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDenomination } from "./denominations.mjs";

// Nov 20, 2026, v61: the narration voice lineup. Nine Kokoro
// voices: eight male voices (am_santa is not offered) plus
// af_heart as the one female voice. Nov 21, 2026, v62: a
// tenth voice, am_liam_echo - the 50/50 Liam+Echo blend,
// the default. Chosen by Jeremiah from the staged previews
// (test set 3 #2). af_bella is no longer offered: an account
// that had it saved reads back as the default until the
// pastor picks again. Every allowlist and default in this
// file uses these two constants, so the lineup changes in
// one place.
export const NARRATION_VOICES = ["am_liam_echo", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "af_heart"];
export const DEFAULT_NARRATION_VOICE = "am_liam_echo";

// Nov 20, 2026, v62 (item 1): the app-language setting.
// "en" | "es": the language of the app UI itself (menus,
// buttons, headings), stored per account like the
// denomination. It is NOT the pack language: the pack's
// language is picked per pack on the input page. The same
// two values are listed in lib/appStrings.mjs, which must
// stay free of server imports (client components read it),
// so the list is repeated here rather than imported.
export const APP_LANGUAGES = ["en", "es"];
export const DEFAULT_APP_LANGUAGE = "en";

// Nov 1, 2026, production auth migration: this replaces the
// Step 7 demo auth (lib/auth-demo.mjs, JSON files, 4-digit
// PINs). What changes, and what does not:
// - Pastors now sign in with email + password, at least 8
//   characters. Passwords are stored only as scrypt hashes
//   with a random 16-byte salt, never in plain text.
// - Pastors and sessions live in SQLite (data/auth.db, via
//   Node's built-in node:sqlite, no new native dependency),
//   not in JSON files that any route could overwrite whole.
// - Sessions are random 32-byte tokens, stored only as
//   SHA-256 hashes, httpOnly cookie, 7-day expiry, deleted
//   on sign-out. An expired or unknown token verifies as null.
// - The ownership rule is unchanged: packs, drafts, and jobs
//   are filtered by session email everywhere, and another
//   pastor's id returns "not found", never their data.
// What this is NOT yet: email verification, password reset
// by email, or magic links. Those need an email service,
// which is not configured, so they are not claimed here.
// What IS here since Nov 4, 2026: a 5-miss / 15-minute
// sign-in lockout, a signed-in password change, and a
// local reset script for a forgotten password (see
// scripts/reset-password.mjs). The demo password rule is
// still 8 characters; the live version will ask for more.
// Better Auth was installed in Step 1 but is not used:
// it needs a database adapter and an email provider for
// magic links, and this built-in SQLite password auth gives
// the same hashing and session guarantees without a new
// native dependency or an unconfigured email service.
// Demo test accounts from the JSON files are NOT carried
// over: they were test data, and their PINs do not meet
// the new password rule, so pastors sign up again once.

const DATA = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA, "auth.db");

let db = null;
function getDb() {
  if (db) return db;
  mkdirSync(DATA, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pastors (
      email TEXT PRIMARY KEY, name TEXT NOT NULL, church TEXT NOT NULL,
      salt TEXT NOT NULL, hash TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY, email TEXT NOT NULL,
      name TEXT NOT NULL, church TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email);
  `);
  // Nov 2, 2026, denomination setting: stored only here, in the
  // local auth database on the pastor's own computer. Never sent
  // anywhere, never printed in a pack. Older databases gain the
  // column with the default; no existing pastor is re-prompted.
  const cols = db.prepare("PRAGMA table_info(pastors)").all().map((c) => c.name);
  if (!cols.includes("denomination")) {
    db.exec("ALTER TABLE pastors ADD COLUMN denomination TEXT NOT NULL DEFAULT 'non-denominational'");
  }
  // Nov 3, 2026, church logo: optional, stored as a relative
  // path under public/church-logos (or null). Unlike the
  // denomination, the logo DOES go into a pack: it is the
  // church's own branding, chosen by the pastor, printed on
  // the pack cover. It lives only in this local database and
  // in the pack file, never sent anywhere else.
  if (!cols.includes("logo")) {
    db.exec("ALTER TABLE pastors ADD COLUMN logo TEXT");
  }
  // Nov 11, 2026, v52, Phase 2 member mode: the account's
  // role, "pastor" or "member". A pastor builds packs for a
  // church and can Approve and Lock; a member builds a pack
  // for self, friends, and family, and can never lock. The
  // role is fixed at account creation: signing in with the
  // other mode for the same email is refused, so one email
  // can never be both a pastor and a member, and the two
  // modes can never be confused. Older databases gain the
  // column with the pastor default; no existing pastor is
  // re-prompted, and no existing account changes meaning.
  if (!cols.includes("role")) {
    db.exec("ALTER TABLE pastors ADD COLUMN role TEXT NOT NULL DEFAULT 'pastor'");
  }
  // Nov 4, 2026, sign-in lockout (Mac pastor-role test item
  // 2): 5 wrong passwords in a row lock the account for 15
  // minutes. This is the demo-version lockout: it stops
  // password guessing on a shared computer without an email
  // service. A correct sign-in clears the count. The live
  // version will need stronger rules (see the sign-in page
  // note), but a guessable account with no lockout at all
  // was the gap the test found.
  if (!cols.includes("failedAttempts")) {
    db.exec("ALTER TABLE pastors ADD COLUMN failedAttempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("lockedUntil")) {
    db.exec("ALTER TABLE pastors ADD COLUMN lockedUntil INTEGER");
  }
  // Nov 5, 2026, v33 (Google API first): the writing model. 'local'
  // (the 4B on this computer) is the default; 'gemini' means the
  // pastor's Google Gemini key is used instead. The key lives only
  // here, in the local auth database on the pastor's own computer.
  // It is never in a pack, never in a log, and never sent anywhere
  // except to Google's API when the pastor picks Gemini. Older
  // databases gain both columns with the local default; no existing
  // pastor is re-prompted.
  if (!cols.includes("modelBackend")) {
    db.exec("ALTER TABLE pastors ADD COLUMN modelBackend TEXT NOT NULL DEFAULT 'local'");
  }
  if (!cols.includes("geminiApiKey")) {
    db.exec("ALTER TABLE pastors ADD COLUMN geminiApiKey TEXT");
  }
  // Nov 9, 2026, v43 (Grok API first): the writing model can now
  // be Grok (xAI) as well. The pastor brings their own Grok key
  // (console.x.ai, paid, about $0.03 a pack on grok-4.1-fast).
  // Google's Gemini free tier stopped working (403, free tier not
  // available, even for a fresh key), so Grok is the API going
  // forward and Gemini stays as a paid option. The Grok key lives
  // only here, like the Gemini key: never in a pack, never in a
  // log, never sent anywhere except to xAI's API when the pastor
  // picks Grok. Older databases gain the column; no existing
  // pastor is re-prompted.
  if (!cols.includes("grokApiKey")) {
    db.exec("ALTER TABLE pastors ADD COLUMN grokApiKey TEXT");
  }
  // Nov 9, 2026, v47 (OpenRouter first): the writing model can now
  // be OpenRouter as well. The pastor brings their own OpenRouter
  // key (openrouter.ai, $5 of credits covers hundreds of packs).
  // OpenRouter serves GLM 5.3 Flash (z-ai/glm-5.3-flash, about
  // $0.01 a pack measured Nov 9), the cheapest capable model found
  // and the best hallucination record in testing. The OpenRouter key lives only
  // here, like the Gemini and Grok keys: never in a pack, never in
  // a log, never sent anywhere except to OpenRouter's API when the
  // pastor picks OpenRouter. Older databases gain the column; no
  // existing pastor is re-prompted.
  // Nov 11, 2026, v54, Phase 4 doctrinal profile: the
  // pastor's own short statement of faith (at most 2000
  // characters), in their own words. It steers the writing
  // model for their packs, alongside the default guidance,
  // and the review page flags anything that leans against
  // it. It lives only here, in the local auth database on
  // the pastor's own computer. It is never printed in a
  // pack or PDF, and it is sent nowhere except to the
  // writing model the pastor already chose, as part of the
  // pack's own prompts, like the sermon text. Older
  // databases gain the column empty; no existing pastor is
  // re-prompted.
  if (!cols.includes("doctrinalStatement")) {
    db.exec("ALTER TABLE pastors ADD COLUMN doctrinalStatement TEXT");
  }
  // Nov 11, 2026, v54, Phase 4 audio narration: the pastor's
  // picked narration voice, one of the ten Kokoro voices in
  // NARRATION_VOICES (am_liam_echo default since v62). No voice
  // cloning: the voice is a fixed choice, never a recording
  // of anyone. Older databases gain the column with the
  // default; no existing pastor is re-prompted. Nov 21,
  // 2026, v62: the column default is the blend, but only
  // for databases gaining the column now - an existing
  // account keeps its stored voice, whatever it is, because
  // nothing here rewrites a stored value.
  if (!cols.includes("narrationVoice")) {
    db.exec("ALTER TABLE pastors ADD COLUMN narrationVoice TEXT NOT NULL DEFAULT 'am_liam_echo'");
  }
  // Nov 20, 2026, v62 (item 1): the app-language setting,
  // "en" | "es". The language of the app UI itself, never
  // the pack language. Older databases gain the column
  // with the English default; no existing pastor is
  // re-prompted, and a returning sign-in never overwrites
  // it (only the settings page changes it, or a new
  // account's creation value).
  if (!cols.includes("appLanguage")) {
    db.exec("ALTER TABLE pastors ADD COLUMN appLanguage TEXT NOT NULL DEFAULT 'en'");
  }
  if (!cols.includes("openrouterApiKey")) {
    db.exec("ALTER TABLE pastors ADD COLUMN openrouterApiKey TEXT");
  }
  return db;
}

const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function lockoutRemainingMs(row) {
  if (!row?.lockedUntil) return 0;
  return Math.max(0, row.lockedUntil - Date.now());
}

export function changePassword(email, currentPassword, newPassword) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!newPassword || String(newPassword).length < 8) throw new Error("Password must be at least 8 characters.");
  const d = getDb();
  const existing = d.prepare("SELECT * FROM pastors WHERE email = ?").get(cleanEmail);
  if (!existing) throw new Error("Pastor not found.");
  const attempt = hashPassword(String(currentPassword), existing.salt);
  const a = Buffer.from(attempt, "hex"), b = Buffer.from(existing.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Wrong current password.");
  const salt = randomBytes(16).toString("hex");
  d.prepare("UPDATE pastors SET salt = ?, hash = ?, failedAttempts = 0, lockedUntil = NULL WHERE email = ?")
    .run(salt, hashPassword(String(newPassword), salt), cleanEmail);
  return getPastor(cleanEmail);
}

// Nov 4, 2026, local password recovery (Mac test item 3):
// there is still no email service, so there is still no
// email reset, and none is claimed. What exists instead is
// honest for a local app: anyone who can run a script in
// the app folder already has full access to this computer's
// Flockpath data, so the reset script is not a weaker door
// than the data itself. It sets a new password and clears
// any lockout, and it never prints the password.
export function resetPassword(email, newPassword) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!newPassword || String(newPassword).length < 8) throw new Error("Password must be at least 8 characters.");
  const d = getDb();
  const existing = d.prepare("SELECT * FROM pastors WHERE email = ?").get(cleanEmail);
  if (!existing) throw new Error("Pastor not found.");
  const salt = randomBytes(16).toString("hex");
  d.prepare("UPDATE pastors SET salt = ?, hash = ?, failedAttempts = 0, lockedUntil = NULL WHERE email = ?")
    .run(salt, hashPassword(String(newPassword), salt), cleanEmail);
  return getPastor(cleanEmail);
}

export function getPastor(email) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const row = getDb().prepare("SELECT email, name, church, denomination, logo, modelBackend, geminiApiKey, grokApiKey, openrouterApiKey, role, doctrinalStatement, narrationVoice, appLanguage FROM pastors WHERE email = ?").get(cleanEmail);
  if (!row) return null;
  // The full key is never returned. The browser only ever sees
  // whether a key is saved and a masked hint (first 4 + last 4),
  // so the pastor can tell which key is stored without the key
  // itself leaving the server.
  const key = row.geminiApiKey || "";
  const grokKey = row.grokApiKey || "";
  const openrouterKey = row.openrouterApiKey || "";
  const backend = row.modelBackend === "gemini" ? "gemini" : row.modelBackend === "grok" ? "grok" : row.modelBackend === "openrouter" ? "openrouter" : "local";
  return {
    email: row.email, name: row.name, church: row.church,
    role: row.role === "member" ? "member" : "pastor",
    denomination: row.denomination || "non-denominational", logo: row.logo || null,
    // Nov 11, 2026, v54: the doctrinal statement rides here
    // so settings, signup, and the generate route can read
    // it. It is the pastor's own words, shown back only to
    // the signed-in pastor, never in a pack.
    doctrinalStatement: row.doctrinalStatement || "",
    // Nov 11, 2026, v54: the narration voice, one of the
    // ten Kokoro voices in NARRATION_VOICES; anything else
    // falls back to the default, never to a failure.
    narrationVoice: NARRATION_VOICES.includes(row.narrationVoice) ? row.narrationVoice : DEFAULT_NARRATION_VOICE,
    // Nov 20, 2026, v62 (item 1): the app language, "en" |
    // "es"; anything else falls back to English, never to a
    // failure. This is the UI language, not the pack's.
    appLanguage: APP_LANGUAGES.includes(row.appLanguage) ? row.appLanguage : DEFAULT_APP_LANGUAGE,
    modelBackend: backend,
    hasGeminiKey: Boolean(key),
    geminiKeyMasked: key ? `${key.slice(0, 4)}...${key.slice(-4)}` : null,
    hasGrokKey: Boolean(grokKey),
    grokKeyMasked: grokKey ? `${grokKey.slice(0, 4)}...${grokKey.slice(-4)}` : null,
    hasOpenRouterKey: Boolean(openrouterKey),
    openrouterKeyMasked: openrouterKey ? `${openrouterKey.slice(0, 4)}...${openrouterKey.slice(-4)}` : null,
  };
}

export function setModelBackend(email, backend) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const value = backend === "gemini" ? "gemini" : backend === "grok" ? "grok" : backend === "openrouter" ? "openrouter" : "local";
  const info = getDb().prepare("UPDATE pastors SET modelBackend = ? WHERE email = ?").run(value, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setGeminiKey(email, apiKey) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const key = String(apiKey ?? "").trim();
  // An empty key clears the stored key. A real AI Studio key is a
  // long string; anything under 10 characters is a paste mistake,
  // not a key, and is rejected rather than saved.
  if (key && key.length < 10) throw new Error("That doesn't look like a Google API key. Paste the full key from AI Studio.");
  const info = getDb().prepare("UPDATE pastors SET geminiApiKey = ? WHERE email = ?").run(key || null, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setGrokKey(email, apiKey) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const key = String(apiKey ?? "").trim();
  // An empty key clears the stored key. A real xAI key is a long
  // string; anything under 10 characters is a paste mistake, not
  // a key, and is rejected rather than saved.
  if (key && key.length < 10) throw new Error("That doesn't look like a Grok API key. Paste the full key from console.x.ai.");
  const info = getDb().prepare("UPDATE pastors SET grokApiKey = ? WHERE email = ?").run(key || null, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setOpenRouterKey(email, apiKey) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const key = String(apiKey ?? "").trim();
  // An empty key clears the stored key. A real OpenRouter key
  // starts with "sk-or-v1-" and is long; anything under 10
  // characters is a paste mistake, not a key, and is rejected
  // rather than saved.
  if (key && key.length < 10) throw new Error("That doesn't look like an OpenRouter API key. Paste the full key from openrouter.ai.");
  const info = getDb().prepare("UPDATE pastors SET openrouterApiKey = ? WHERE email = ?").run(key || null, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setLogo(email, logo) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (logo !== null && !/^church-logos\/[A-Za-z0-9._-]+\.(png|jpg|jpeg)$/i.test(logo)) throw new Error("Invalid logo path.");
  const info = getDb().prepare("UPDATE pastors SET logo = ? WHERE email = ?").run(logo, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setDenomination(email, denomination) {
  if (!isDenomination(denomination)) throw new Error("Unknown denomination.");
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const info = getDb().prepare("UPDATE pastors SET denomination = ? WHERE email = ?").run(denomination, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setDoctrinalStatement(email, statement) {
  // Nov 11, 2026, v54, Phase 4 doctrinal profile: a short
  // statement in the pastor's own words, at most 2000
  // characters. An empty string clears it. It steers the
  // writing model and the review check, and is never printed
  // in a pack.
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const value = String(statement ?? "").trim().slice(0, 2000);
  const info = getDb().prepare("UPDATE pastors SET doctrinalStatement = ? WHERE email = ?").run(value || null, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setNarrationVoice(email, voice) {
  // Nov 11, 2026, v54, Phase 4 audio narration: the voice
  // must be one of the ten Kokoro voices in
  // NARRATION_VOICES (v62 lineup, am_liam_echo default). An
  // unknown value is refused, not silently saved.
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!NARRATION_VOICES.includes(voice)) throw new Error("Unknown narration voice.");
  const info = getDb().prepare("UPDATE pastors SET narrationVoice = ? WHERE email = ?").run(voice, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function setAppLanguage(email, language) {
  // Nov 20, 2026, v62 (item 1): the app language, "en" |
  // "es". An unknown value is refused, not silently saved.
  // Only the settings page calls this; a returning sign-in
  // never overwrites the stored language.
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!APP_LANGUAGES.includes(language)) throw new Error("Unknown app language.");
  const info = getDb().prepare("UPDATE pastors SET appLanguage = ? WHERE email = ?").run(language, cleanEmail);
  if (info.changes === 0) throw new Error("Pastor not found.");
  return getPastor(cleanEmail);
}

export function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}
export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function signInOrCreate({ email, password, name, church, denomination, role, doctrinalStatement, appLanguage }) {
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!cleanEmail.includes("@")) throw new Error("Enter a valid email.");
  if (!password || String(password).length < 8) throw new Error("Password must be at least 8 characters.");
  // Nov 11, 2026, v52, Phase 2 member mode: the sign-in
  // page offers Pastor or Member. A member signs up with a
  // first name only and no church; a pastor needs a name and
  // a church, as before. The role is fixed at creation.
  const wantRole = role === "member" ? "member" : "pastor";
  if (!name?.trim()) throw new Error(wantRole === "member" ? "Your first name is required." : "Name and church are required.");
  if (wantRole === "pastor" && !church?.trim()) throw new Error("Name and church are required.");
  // Denomination is optional and skippable at signup; an unknown
  // value falls back to the default rather than failing sign-in.
  // A returning sign-in never overwrites the stored setting:
  // settings change it, not a stale form value.
  const denom = isDenomination(denomination) ? denomination : "non-denominational";
  // Nov 20, 2026, v62 (item 1): the app language at signup,
  // like the denomination. A new account stores it. A
  // returning sign-in never overwrites the stored language:
  // only the settings page changes it. An unknown value
  // falls back to English rather than failing sign-in.
  const lang = APP_LANGUAGES.includes(appLanguage) ? appLanguage : DEFAULT_APP_LANGUAGE;
  // Nov 11, 2026, v54, Phase 4 doctrinal profile: optional
  // and skippable at signup, like the tradition. A new
  // account stores it. Nov 20, 2026, v61: a returning
  // sign-in saves the typed statement too, when it is
  // non-empty and differs from the stored one, so a profile
  // typed on the sign-in page is no longer silently dropped.
  // An empty field leaves the stored statement alone, so a
  // stale form value can never wipe it. At most 2000
  // characters.
  const doctrinal = String(doctrinalStatement ?? "").trim().slice(0, 2000);
  // Nov 11, 2026, v52: a member has no church, so the church
  // value is empty for a member whether or not the caller
  // sent one; a pastor's church is the typed value. This is
  // computed once here, because the session insert at the
  // end used to call church.trim() on an undefined church
  // and crash a member sign-in that sent no church field,
  // after the account row was already created.
  const churchValue = wantRole === "member" ? "" : String(church ?? "").trim();
  const d = getDb();
  const existing = d.prepare("SELECT * FROM pastors WHERE email = ?").get(cleanEmail);
  if (existing) {
    // Nov 11, 2026, v52: one email, one role. A pastor
    // account cannot sign in as a member, and a member
    // account cannot sign in as a pastor; the two modes
    // stay separate, so a pack can never be built in the
    // wrong mode by mistake.
    const existingRole = existing.role === "member" ? "member" : "pastor";
    if (existingRole !== wantRole) {
      throw new Error(existingRole === "member"
        ? "This email is a member account. Sign in as a member, not as a pastor."
        : "This email is a pastor account. Sign in as a pastor, not as a member.");
    }
    const remaining = lockoutRemainingMs(existing);
    if (remaining > 0) {
      const mins = Math.max(1, Math.ceil(remaining / 60000));
      throw new Error(`Too many wrong passwords. This account is locked for ${mins} more minute${mins === 1 ? "" : "s"}. Try again later, or reset it with the script on the forgot-password page.`);
    }
    const attempt = hashPassword(String(password), existing.salt);
    const a = Buffer.from(attempt, "hex"), b = Buffer.from(existing.hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      const fails = (existing.failedAttempts || 0) + 1;
      if (fails >= LOCKOUT_AFTER) {
        d.prepare("UPDATE pastors SET failedAttempts = ?, lockedUntil = ? WHERE email = ?").run(fails, Date.now() + LOCKOUT_MS, cleanEmail);
        throw new Error("Too many wrong passwords. This account is locked for 15 minutes. Try again later, or reset it with the script on the forgot-password page.");
      }
      d.prepare("UPDATE pastors SET failedAttempts = ? WHERE email = ?").run(fails, cleanEmail);
      throw new Error("Wrong password for that email.");
    }
    // Nov 11, 2026, v52: a member has no church, so a
    // returning member sign-in keeps church empty; a pastor
    // sign-in keeps the church they type, as before.
    // Nov 20, 2026, v61: a non-empty typed statement that
    // differs from the stored one is saved here too; an
    // empty field leaves the stored statement alone.
    d.prepare("UPDATE pastors SET name = ?, church = ?, failedAttempts = 0, lockedUntil = NULL WHERE email = ?").run(name.trim(), churchValue, cleanEmail);
    if (doctrinal && doctrinal !== (existing.doctrinalStatement || "")) {
      d.prepare("UPDATE pastors SET doctrinalStatement = ? WHERE email = ?").run(doctrinal, cleanEmail);
    }
  } else {
    const salt = randomBytes(16).toString("hex");
    // Nov 20, 2026, v61: the voice is written explicitly
    // here, not left to the column default, so a new account
    // gets am_liam_echo even on a database whose narrationVoice
    // column was added before v62 with an older default
    // (the migration only adds a missing column, it never
    // rewrites an existing default). Nov 21, 2026, v62: the
    // default is the Liam+Echo blend; an existing account
    // keeps its stored voice and is never migrated.
    d.prepare("INSERT INTO pastors (email, name, church, salt, hash, createdAt, denomination, role, doctrinalStatement, narrationVoice, appLanguage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(cleanEmail, name.trim(), churchValue, salt, hashPassword(String(password), salt), Date.now(), denom, wantRole, doctrinal || null, DEFAULT_NARRATION_VOICE, lang);
  }
  const token = randomBytes(32).toString("hex");
  d.prepare("INSERT INTO sessions (tokenHash, email, name, church, expiresAt) VALUES (?, ?, ?, ?, ?)")
    .run(hashToken(token), cleanEmail, name.trim(), churchValue, Date.now() + 7 * 24 * 60 * 60 * 1000);
  return { token, email: cleanEmail, name: name.trim(), church: churchValue };
}

export function verifySession(token) {
  if (!token) return null;
  const d = getDb();
  const s = d.prepare("SELECT * FROM sessions WHERE tokenHash = ?").get(hashToken(token));
  if (!s || s.expiresAt < Date.now()) {
    if (s) d.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(hashToken(token));
    return null;
  }
  // Nov 11, 2026, v52: the role comes from the account row,
  // not the session row, so a session made before member
  // mode still carries the right role, and a role never
  // rides in a cookie value the client could change.
  const account = getPastor(s.email);
  return { email: s.email, name: s.name, church: s.church, role: account?.role ?? "pastor", expiresAt: s.expiresAt };
}

export function signOut(token) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE tokenHash = ?").run(hashToken(token));
}

export function loadLibrary() {
  try {
    if (existsSync(path.join(DATA, "packs-library.json"))) return JSON.parse(readFileSync(path.join(DATA, "packs-library.json"), "utf-8"));
  } catch {}
  return [];
}
export function saveToLibrary(entry) {
  const lib = loadLibrary();
  const i = lib.findIndex((e) => e.id === entry.id && e.email === entry.email);
  if (i >= 0) lib[i] = entry; else lib.push(entry);
  writeFileSync(path.join(DATA, "packs-library.json"), JSON.stringify(lib, null, 1));
  return lib;
}
