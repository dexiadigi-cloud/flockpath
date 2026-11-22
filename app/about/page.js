// About Flockpath: a small public page, no sign-in needed.
// It invents nothing: no pricing, no signup, no demo link,
// no hosted share claim. The app is local, the pastor reviews,
// and only Approve and Lock publishes a pack.
// Nov 21, 2026, v63: the page reads in the signed-in
// account's app language (AppHeader pattern); unsigned
// visitors get English. Proper nouns, URLs, numbers,
// dollar figures, and the version string stay as-is.
import { cookies } from "next/headers";
import { verifySession, getPastor } from "../../lib/auth.mjs";
import { t } from "../../lib/appStrings.mjs";
import { FLOCKPATH_VERSION } from "../../lib/version.mjs";

export default async function About() {
  let appLanguage = "en";
  try {
    const store = await cookies();
    const session = verifySession(store.get("flockpath_session")?.value);
    if (session) appLanguage = getPastor(session.email)?.appLanguage || "en";
  } catch { /* unsigned: English */ }

  return (
    <main className="fp-main fp-main-narrow">
      <h1>{t(appLanguage, "about.title")}</h1>
      <p>{t(appLanguage, "about.tagline")}</p>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "about.howMade")}</h2>
        <div className="fp-about-steps">
          <div className="fp-about-step">
            <p><strong>{t(appLanguage, "about.step1Title")}</strong> {t(appLanguage, "about.step1Body")}</p>
          </div>
          <div className="fp-about-step">
            <p><strong>{t(appLanguage, "about.step2Title")}</strong> {t(appLanguage, "about.step2Body")}</p>
          </div>
          <div className="fp-about-step">
            <p><strong>{t(appLanguage, "about.step3Title")}</strong> {t(appLanguage, "about.step3Body")}</p>
          </div>
          <div className="fp-about-step">
            <p><strong>{t(appLanguage, "about.step4Title")}</strong> {t(appLanguage, "about.step4Body")}</p>
          </div>
        </div>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "about.howAi")}</h2>
        <p>{t(appLanguage, "about.aiIntro")}</p>
        <p>{t(appLanguage, "about.aiNever")}</p>
        <ul>
          <li>{t(appLanguage, "about.aiNever1")}</li>
          <li>{t(appLanguage, "about.aiNever2")}</li>
          <li>{t(appLanguage, "about.aiNever3")}</li>
          <li>{t(appLanguage, "about.aiNever4")}</li>
        </ul>
        <p>{t(appLanguage, "about.aiChecks")}</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "about.safeguards")}</h2>
        <ul>
          <li>{t(appLanguage, "about.safe1")}</li>
          <li>{t(appLanguage, "about.safe2")}</li>
          <li>{t(appLanguage, "about.safe3")}</li>
          <li>{t(appLanguage, "about.safe4")}</li>
          <li>{t(appLanguage, "about.safe5")}</li>
        </ul>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "about.translations")}</h2>
        <p>{t(appLanguage, "about.transIntro")}</p>
        <ul>
          <li><strong>{t(appLanguage, "about.transEnTitle")}</strong> {t(appLanguage, "about.transEnBody")}</li>
          <li><strong>{t(appLanguage, "about.transRvTitle")}</strong> {t(appLanguage, "about.transRvBody")}</li>
          <li><strong>{t(appLanguage, "about.transEsTitle")}</strong> {t(appLanguage, "about.transEsBody")}</li>
        </ul>
        <p>{t(appLanguage, "about.spanishHymns")}</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "about.cost")}</h2>
        <p>{t(appLanguage, "about.costBody")}</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>{t(appLanguage, "about.coloring")}</h2>
        <p>{t(appLanguage, "about.coloringBody")}</p>
        <p style={{ textAlign: "center" }}>
          <img src="/coloring/shepherd-sheep.png" alt={t(appLanguage, "about.coloringAlt1")} width={200} style={{ border: "1px solid #ccc", background: "#fff", marginRight: 12 }} />
          <img src="/coloring/creation-sky-sea.png" alt={t(appLanguage, "about.coloringAlt2")} width={200} style={{ border: "1px solid #ccc", background: "#fff" }} />
        </p>
        <p style={{ textAlign: "center", fontSize: 14 }}>{t(appLanguage, "about.coloringCaption")}</p>
      </section>

      <section className="fp-about-card" style={{ textAlign: "center" }}>
        <img src="/dexia-digi-logo.jpg" alt={t(appLanguage, "about.logoAlt")} width={140} height={140} />
        <p>{t(appLanguage, "about.builtWithLove")}</p>
        <p style={{ fontSize: 14 }}>Version {FLOCKPATH_VERSION} {t(appLanguage, "about.localBuild")}.</p>
        <p style={{ fontSize: 14 }}>{t(appLanguage, "about.license")}</p>
        <p><a href="/signin">{t(appLanguage, "about.signIn")}</a> | <a href="/credits">{t(appLanguage, "about.creditsLink")}</a></p>
      </section>
    </main>
  );
}
