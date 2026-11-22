"use client";

import { useState } from "react";
import { DENOMINATIONS, denominationMessage } from "../../lib/denominations.mjs";

export default function SignIn() {
  // Nov 11, 2026, v52, Phase 2 member mode: one sign-in
  // page, two modes. A pastor builds packs for a church and
  // can Approve and Lock; a member builds a personal study
  // for self, friends, and family, and can never lock. The
  // mode is picked here, at sign-in, and the whole app is
  // labeled by it. One email, one role: an account created
  // as a pastor cannot sign in as a member, and the reverse.
  const [role, setRole] = useState("pastor");
  const [name, setName] = useState("");
  const [church, setChurch] = useState("");
  const [email, setEmail] = useState("pastor@sample.church");
  const [password, setPassword] = useState("");
  const [denomination, setDenomination] = useState("non-denominational");
  // Nov 11, 2026, v54, Phase 4 doctrinal profile: a short
  // statement of faith, optional and skippable at signup,
  // pastor-only like the tradition. It steers the writing
  // model for the pastor's packs, and review flags anything
  // that leans against it. Never printed in a pack.
  const [doctrinalStatement, setDoctrinalStatement] = useState("");
  // Nov 20, 2026, v62 (item 1): the app language, optional
  // and skippable at signup like the tradition. A new account
  // stores it; a returning sign-in never overwrites the
  // stored language, which changes only on My packs.
  const [appLanguage, setAppLanguage] = useState("en");
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState("");
  const isMember = role === "member";

  async function submit(e) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/signin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, church: isMember ? "" : church, email, password, denomination, role, doctrinalStatement: isMember ? "" : doctrinalStatement, appLanguage }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Sign-in failed."); return; }
    if (logoFile && !isMember) {
      const form = new FormData();
      form.append("logo", logoFile);
      const up = await fetch("/api/logo", { method: "POST", body: form });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) { setError(upData.error ?? "Logo upload failed."); return; }
    }
    // Nov 4, 2026, new-account landing (Mac test item 5):
    // a pastor who just signed in starts a pack, they do not
    // land on a review page with a demo already loaded.
    window.location.href = "/input";
  }

  const input = { display: "block", width: "100%", padding: 8, marginBottom: 12, fontSize: 15 };
  return (
    <main className="fp-signin-card">
      <img src="/flockpath-logo.png" alt="Flockpath logo" width={88} height={76} />
      <h1 style={{ marginBottom: 4 }}>Flockpath: {isMember ? "member sign-in" : "pastor sign-in"}</h1>
      <p style={{ marginTop: 0 }}>From Sunday&apos;s sermon to a week of family discipleship, pastor-approved and printable.</p>
      <div style={{ margin: "16px 0 8px" }}>
        <p style={{ margin: "0 0 10px", fontStyle: "italic", fontSize: 16, lineHeight: 1.5 }}>&ldquo;Do not be afraid, little flock, for your Father is pleased to give you the kingdom.&rdquo; <strong style={{ fontStyle: "normal" }}>Luke 12:32 (BSB)</strong></p>
        <p style={{ margin: 0, fontStyle: "italic", fontSize: 16, lineHeight: 1.5 }}>&ldquo;Your word is a lamp to my feet and a light to my path.&rdquo; <strong style={{ fontStyle: "normal" }}>Psalm 119:105 (BSB)</strong></p>
      </div>
      <div style={{ textAlign: "left" }}>
      <div className="fp-role-pick">
        <label><input type="radio" name="role" checked={!isMember} onChange={() => setRole("pastor")} /> I am a pastor, building packs for my church</label>
        <label><input type="radio" name="role" checked={isMember} onChange={() => setRole("member")} /> I am building a personal study for myself and my family</label>
      </div>
      {isMember && <p><strong>Member packs are personal study.</strong> Every member pack is labeled &ldquo;Personal study, not pastor-approved&rdquo; on the cover and every page. It is never locked, never carries a church name, and never claims a pastor approved it. You can send a draft to your pastor for approval, and if your pastor locks it, it becomes a church pack.</p>}
      <p>First sign-in with an email creates that {isMember ? "member" : "pastor"} with the password you choose. Returning sign-in needs the same password. Passwords are stored only as a scrypt hash, never in plain text. Sessions last 7 days and are deleted on sign-out. After 5 wrong passwords in a row, the account locks for 15 minutes.</p>
      <p><strong>Password rule for this demo version:</strong> at least 8 characters. A future version will ask for more.</p>
      <p><strong>Note:</strong> email verification and password reset by email are not built, because no email service is configured. They are not claimed here. If you forget your password, the <a href="/forgot">forgot-password page</a> explains the local reset script, and you can change your password on My packs while signed in.</p>
      <form onSubmit={submit}>
        <input style={input} placeholder={isMember ? "Your first name" : "Your name"} value={name} onChange={(e) => setName(e.target.value)} />
        {!isMember && <input style={input} placeholder="Church" value={church} onChange={(e) => setChurch(e.target.value)} />}
        <input style={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={input} placeholder="Password, at least 8 characters" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {!isMember && (
          <>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>My tradition (optional, skippable - leave it on the default if you prefer)</label>
            <select style={input} value={denomination} onChange={(e) => setDenomination(e.target.value)}>
              {DENOMINATIONS.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
            <p>{denominationMessage(denomination)}</p>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>My doctrinal profile (optional, skippable - a short statement of faith in your own words)</label>
            <textarea style={{ ...input, minHeight: 80 }} placeholder="e.g. We hold to the Baptist Faith and Message: Scripture alone is our authority, salvation is by grace alone through faith alone in Christ alone." value={doctrinalStatement} maxLength={2000} onChange={(e) => setDoctrinalStatement(e.target.value)} />
            <p style={{ marginTop: -8 }}>It steers the writing model for your packs, and review flags anything that leans against it. It never appears in a pack or PDF, and it is never sent anywhere except to the writing model you already chose, as part of your pack&apos;s own prompts. You can add or change it later on My packs.</p>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Church logo (optional - prints on your pack covers)</label>
            <input style={input} type="file" accept="image/png,image/jpeg" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
            <p style={{ marginTop: -8 }}>PNG or JPEG, under 2 MB. You can add or change it later on My packs.</p>
          </>
        )}
        <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>App language (optional - the language of the app itself, not of your packs)</label>
        <p style={{ marginTop: -8 }}>
          <label><input type="radio" name="app-language" checked={appLanguage === "en"} onChange={() => setAppLanguage("en")} /> English</label>{" "}
          <label><input type="radio" name="app-language" checked={appLanguage === "es"} onChange={() => setAppLanguage("es")} /> Español</label>
        </p>
        <p style={{ marginTop: -8 }}>For a new account, this sets the app language. For a returning sign-in it changes nothing; change it later on My packs.</p>
        {error && <p style={{ color: "darkred" }}>{error}</p>}
        <button className="fp-btn-mobile-block" style={{ padding: "10px 18px", fontSize: 16 }}>Sign in</button>
        <p><a href="/forgot">Forgot your password?</a></p>
      </form>
      <p>Tip: view the Genesis 1 demo pack any time at <a href="/pack/generated-genesis-1">/pack/generated-genesis-1</a>.</p>
      </div>
    </main>
  );
}
