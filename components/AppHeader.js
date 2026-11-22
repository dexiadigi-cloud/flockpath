// Shared app header, v55, Nov 12, 2026: the navy sidebar from
// the approved mockups (Design 1). Brand and bell at the top,
// nav below, free-forever note at the foot. On small screens
// the sidebar becomes a top bar (see globals.css media query).
// The bell is in-app only: it counts the pastor's drafts
// awaiting review, links to My packs, and shows a gold count
// badge when at least one draft is waiting. Nothing is sent
// anywhere, and no push or email exists. Server-rendered from
// the session cookie, so it also renders on the sign-in and
// About pages (no bell there until signed in). No session
// logic changes: protected pages still redirect on their own.
import { cookies } from "next/headers";
import { verifySession, getPastor } from "../lib/auth.mjs";
import { t } from "../lib/appStrings.mjs";
import { listDraftsFor } from "../app/api/drafts/route";

export default async function AppHeader() {
  let draftCount = 0;
  let signedIn = false;
  // Nov 20, 2026, v62 (item 1): the navigation renders in the
  // signed-in pastor's app language, read from the account
  // here, server-side. Unsigned visitors see English.
  let appLanguage = "en";
  try {
    const store = await cookies();
    const session = verifySession(store.get("flockpath_session")?.value);
    if (session) {
      signedIn = true;
      draftCount = listDraftsFor(session.email).length;
      appLanguage = getPastor(session.email)?.appLanguage || "en";
    }
  } catch { /* unsigned or unreadable session: no bell */ }

  const draftWords = draftCount === 1 ? t(appLanguage, "nav.draftsWaitingOne") : t(appLanguage, "nav.draftsWaiting");
  const bellLabel = draftCount ? `${draftCount} ${draftWords}` : t(appLanguage, "nav.noDrafts");

  return (
    <header className="fp-header">
      <div className="fp-brand-row">
        <a href="/" className="fp-brand">
          <img src="/flockpath-logo.png" alt="Flockpath logo" width={44} height={38} />
          <span>Flockpath</span>
        </a>
        {signedIn && (
          <a href="/packs#drafts" className="fp-bell" aria-label={bellLabel} title={bellLabel}>
            <span aria-hidden="true">&#128276;</span>
            {draftCount > 0 && <span className="fp-bell-count">{draftCount}</span>}
          </a>
        )}
      </div>
      <nav className="fp-nav">
        <a href="/input" className="fp-nav-cta">{t(appLanguage, "nav.start")}</a>
        <a href="/">{t(appLanguage, "nav.dashboard")}</a>
        <a href="/review">{t(appLanguage, "nav.review")}</a>
        <a href="/packs">{t(appLanguage, "nav.packs")}</a>
        <a href="/about">{t(appLanguage, "nav.about")}</a>
        <a href="/credits">{t(appLanguage, "nav.credits")}</a>
      </nav>
      <p className="fp-sidebar-foot">{t(appLanguage, "nav.freeNote")}</p>
    </header>
  );
}
