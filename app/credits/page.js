// Credits: a small public page, no sign-in needed.
// Nov 21, 2026, v63: the page reads in the signed-in
// account's app language (AppHeader pattern); unsigned
// visitors get English. EXCEPTION: the two formal CC BY 4.0
// attribution paragraphs (STEPBible lexicon/interlinear
// data, Brown-Driver-Briggs) are verbatim attribution
// statements, so they stay in the original English in both
// languages; the dictionary carries the same English text
// for the "es" table on purpose.
import { cookies } from "next/headers";
import { verifySession, getPastor } from "../../lib/auth.mjs";
import { t } from "../../lib/appStrings.mjs";

export default async function Credits() {
  let appLanguage = "en";
  try {
    const store = await cookies();
    const session = verifySession(store.get("flockpath_session")?.value);
    if (session) appLanguage = getPastor(session.email)?.appLanguage || "en";
  } catch { /* unsigned: English */ }

  return (
    <main className="fp-main fp-main-narrow">
      <h1>{t(appLanguage, "credits.title")}</h1>
      <p>{t(appLanguage, "credits.intro")}</p>
      <h2>{t(appLanguage, "credits.software")}</h2>
      <p>{t(appLanguage, "credits.softwareBody")}</p>
      <h2>{t(appLanguage, "credits.model")}</h2>
      <p>{t(appLanguage, "credits.modelBody")}</p>
      <h2>{t(appLanguage, "credits.scripture")}</h2>
      <p>{t(appLanguage, "credits.scriptureBody")}</p>
      <h2>{t(appLanguage, "credits.studySources")}</h2>
      <p>{t(appLanguage, "credits.studySourcesBody")}</p>
      <h2>{t(appLanguage, "credits.attribution")}</h2>
      <p>{t(appLanguage, "credits.attributionIntro")}</p>
      <p>{t(appLanguage, "credits.stepBible")}</p>
      <p>{t(appLanguage, "credits.bdb")}</p>
      <h2>{t(appLanguage, "credits.hymns")}</h2>
      <p>{t(appLanguage, "credits.hymnsBody")}</p>
      <h2>{t(appLanguage, "credits.nameLogo")}</h2>
      <p>{t(appLanguage, "credits.nameLogoBody")}</p>
      <p><a href="/">{t(appLanguage, "credits.back")}</a></p>
    </main>
  );
}
