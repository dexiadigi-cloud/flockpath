import "./globals.css";
import { cookies } from "next/headers";
import AppHeader from "../components/AppHeader";
import { AppLanguageProvider } from "../components/AppLanguage";
import { verifySession, getPastor } from "../lib/auth.mjs";

export const metadata = {
  title: "Flockpath - Pastor Review",
  description: "Pastor-approved family discipleship packs, with verified Scripture and a lock gate.",
};

export default async function RootLayout({ children }) {
  // Nov 20, 2026, v62 (item 1): the document language and the
  // client-side language context both come from the signed-in
  // account's stored app language. Unsigned visitors get
  // English. The provider's /api/me refresh keeps client-side
  // navigation current; the server shell re-renders on reload.
  let appLanguage = "en";
  try {
    const store = await cookies();
    const session = verifySession(store.get("flockpath_session")?.value);
    if (session) appLanguage = getPastor(session.email)?.appLanguage || "en";
  } catch { /* unsigned: English */ }
  return (
    <html lang={appLanguage}>
      <body>
        <div className="fp-shell">
          <AppHeader />
          <div className="fp-content">
            <AppLanguageProvider initialLanguage={appLanguage}>{children}</AppLanguageProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
