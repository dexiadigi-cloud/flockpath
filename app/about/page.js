// About Flockpath: a small public page, no sign-in needed.
// It invents nothing: no pricing, no signup, no demo link,
// no hosted share claim. The app is local, the pastor reviews,
// and only Approve and Lock publishes a pack.
import { FLOCKPATH_VERSION } from "../../lib/version.mjs";

export default function About() {
  return (
    <main className="fp-main fp-main-narrow">
      <h1>About Flockpath</h1>
      <p>From Sunday&apos;s sermon to a week of family discipleship, pastor-approved and printable.</p>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>How a pack is made</h2>
        <div className="fp-about-steps">
          <div className="fp-about-step">
            <p><strong>1. The pastor gives the passage.</strong> A sermon paste, a verse list, a topic searched in Phos, a file upload, or a YouTube sermon link, which Flockpath reads from the video&apos;s captions, or transcribes on this computer when there are no captions. The tool never picks a passage on its own.</p>
          </div>
          <div className="fp-about-step">
            <p><strong>2. Scripture is filled in by code, not by the model.</strong> Every verse comes from the public-domain Bible store for the pack&apos;s translation, word for word.</p>
          </div>
          <div className="fp-about-step">
            <p><strong>3. The pastor reviews.</strong> An adult devotional and a kid retelling for ages 6-10 for each day (five days by default, or three or seven if the pastor picks a shorter or full week), a locked memory verse, leader questions, a hymn when one matches, otherwise no song page, and a coloring page. Two gates run live as the pastor edits: Scripture exactness and originality.</p>
          </div>
          <div className="fp-about-step">
            <p><strong>4. Approve and Lock locks it.</strong> Nothing is locked until the pastor approves it. The locked pack prints as a Letter PDF the family can use at home, with no app and no login needed to read it. From the review page the pastor can also narrate the pack aloud, free, on this computer, and download the audio to share with the family.</p>
          </div>
        </div>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>How AI works in Flockpath</h2>
        <p>Yes, this tool uses AI, and only in one place: drafting the week&apos;s devotionals. The pastor picks where that writing happens. With Local, a small language model runs on the pastor&apos;s own computer, not on a server. With OpenRouter, Grok, or Google, the writing happens through that provider&apos;s service, using the pastor&apos;s own key, and the passage text goes to that provider. It writes the adult devotionals, the kid retellings, the leader questions, and the prayers, one day at a time, from the pastor&apos;s confirmed passage.</p>
        <p>What the AI never does is just as important:</p>
        <ul>
          <li>It never writes Scripture. The model returns verse references only, and code fills every quote from the public-domain Bible store for the pack&apos;s translation, word for word.</li>
          <li>It never picks the passage. The pastor gives the sermon, the verse list, or the topic, and confirms the verses before anything is drafted.</li>
          <li>It never publishes. The draft stops for the pastor&apos;s review, and nothing locks, prints, or shares until the pastor taps Approve and Lock.</li>
          <li>It never sees family data. Only the passage the pastor gives, and their own doctrinal profile when they wrote one, is sent to the writing model, and with Local it never leaves the pastor&apos;s computer. No family data is collected, and there are no ads in a pack.</li>
        </ul>
        <p>Two automatic checks run as the pastor edits: Scripture exactness (every quote matches the verse store character for character) and originality (a different day each time, not one day said five times). Anything that fails must be fixed, or that section left out, before the pack can lock.</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>Safeguards, in plain language</h2>
        <ul>
          <li>Scripture is retrieved from the verse store for the pack&apos;s translation, never written by the model, and every quote is checked character for character before locking.</li>
          <li>Kid versions are labeled retellings, never presented as Scripture.</li>
          <li>Generation happens where the pastor chose: on the pastor&apos;s own computer with Local, or through the provider&apos;s service with OpenRouter, Grok, or Google, using the pastor&apos;s own key. No family data is collected, and there are no ads in a pack.</li>
          <li>Every hymn is public domain in the US in music, setting, words, and translation, with the setting named.</li>
          <li>A pastor may write a short doctrinal profile in their own words. It steers the writing model for their packs, and review flags anything that leans against it. It never appears in a pack or PDF.</li>
        </ul>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>Bible translations in Flockpath</h2>
        <p>Every pack prints Scripture from one public-domain Bible text, filled in by code, never written by the model. The pastor picks the translation when starting a pack:</p>
        <ul>
          <li><strong>English: Berean Standard Bible (BSB).</strong> Public domain. The English text for every English pack.</li>
          <li><strong>Español: Reina-Valera 1909.</strong> Public domain. One of the two Spanish texts a pastor can pick for a Spanish pack.</li>
          <li><strong>Español: La Biblia en Español Sencillo, 2026 2nd edition.</strong> Public domain. The other Spanish text. Translation by AudioBiblia.org, edited by Irma Flores, credited here as a courtesy. This is the 2026 edition only: the 2018/2019 editions of the same translation are CC BY 4.0, a different license, and are not used in Flockpath.</li>
        </ul>
        <p>Spanish hymns in a Spanish pack come from the same public-domain hymn index as the English hymns: words, music, setting, and translation each checked as public domain in the US.</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>What a pack costs</h2>
        <p>About a penny a family per week. The pastor builds one week&apos;s pack for about a penny on OpenRouter with the GLM model, measured at about $0.01 a pack on Nov 9, 2026, paid from the pastor&apos;s own key, and the same pack prints for every family in the church. A printed bulletin for one family of four costs about a dollar a week (Echo&apos;s own example: $162 a month for 150 people). There is no subscription and no per-member price, and Flockpath itself is free.</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>In every pack: a coloring page</h2>
        <p>One coloring page for the kids, matched to the passage, printable in black and white on any printer.</p>
        <p style={{ textAlign: "center" }}>
          <img src="/coloring/shepherd-sheep.png" alt="Shepherd and sheep coloring page" width={200} style={{ border: "1px solid #ccc", background: "#fff", marginRight: 12 }} />
          <img src="/coloring/creation-sky-sea.png" alt="Creation sky and sea coloring page" width={200} style={{ border: "1px solid #ccc", background: "#fff" }} />
        </p>
        <p style={{ textAlign: "center", fontSize: 14 }}>Shepherd and sheep, the Psalm 23 match, and the creation page.</p>
      </section>

      <section className="fp-about-card" style={{ textAlign: "center" }}>
        <img src="/dexia-digi-logo.jpg" alt="Dexia Digi logo" width={140} height={140} />
        <p>Flockpath is built with love and by the grace of God, by Dexia Digi.</p>
        <p style={{ fontSize: 14 }}>Version {FLOCKPATH_VERSION} (local build).</p>
        <p style={{ fontSize: 14 }}>Flockpath code is released under the MIT License. The Flockpath name and logo are trademarks of Dexia Digi and are not covered by that license.</p>
        <p><a href="/signin">Pastor sign-in</a> | <a href="/credits">Open-source credits</a></p>
      </section>
    </main>
  );
}
