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
import { verifySession } from "../lib/auth.mjs";
import { listDraftsFor } from "../app/api/drafts/route";

export default async function AppHeader() {
  let draftCount = 0;
  let signedIn = false;
  try {
    const store = await cookies();
    const session = verifySession(store.get("flockpath_session")?.value);
    if (session) {
      signedIn = true;
      draftCount = listDraftsFor(session.email).length;
    }
  } catch { /* unsigned or unreadable session: no bell */ }

  return (
    <header className="fp-header">
      <div className="fp-brand-row">
        <a href="/" className="fp-brand">
          <img src="/flockpath-logo.png" alt="Flockpath logo" width={44} height={38} />
          <span>Flockpath</span>
        </a>
        {signedIn && (
          <a href="/packs#drafts" className="fp-bell" aria-label={draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"} waiting for review` : "No drafts waiting for review"} title={draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"} waiting for review` : "No drafts waiting for review"}>
            <span aria-hidden="true">&#128276;</span>
            {draftCount > 0 && <span className="fp-bell-count">{draftCount}</span>}
          </a>
        )}
      </div>
      <nav className="fp-nav">
        <a href="/input" className="fp-nav-cta">+ Start a pack</a>
        <a href="/">Dashboard</a>
        <a href="/review">Review</a>
        <a href="/packs">My packs</a>
        <a href="/about">About</a>
        <a href="/credits">Credits</a>
      </nav>
      <p className="fp-sidebar-foot">Flockpath is free forever, kept going by donations. Nothing you build here leaves this computer unless you send it yourself.</p>
    </header>
  );
}
