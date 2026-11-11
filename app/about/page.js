// About Flockpath: a small public page, no sign-in needed.
// It invents nothing: no pricing, no signup, no demo link,
// no hosted share claim. The app is local, the pastor reviews,
// and only Approve and Lock publishes a pack.
import { FLOCKPATH_VERSION } from "../../lib/version.mjs";

export default function About() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>About Flockpath</h1>
      <p>From Sunday&apos;s sermon to a week of family discipleship, pastor-approved and printable.</p>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>How a pack is made</h2>
        <div className="fp-about-steps">
          <div className="fp-about-step">
            <p><strong>1. The pastor gives the passage.</strong> A sermon paste, a verse list, a topic searched in Phos, or a file upload. The tool never picks a passage on its own.</p>
          </div>
          <div className="fp-about-step">
            <p><strong>2. Scripture is filled in by code, not by the model.</strong> Every verse comes from the public-domain Berean Standard Bible store, word for word.</p>
          </div>
          <div className="fp-about-step">
            <p><strong>3. The pastor reviews.</strong> Five adult devotionals, five kid retellings for ages 6-10, a locked memory verse, leader questions, a hymn when one matches, otherwise no song page, and a coloring page. Two gates run live as the pastor edits: Scripture exactness and originality.</p>
          </div>
          <div className="fp-about-step">
            <p><strong>4. Approve and Lock locks it.</strong> Nothing is locked until the pastor approves it. The locked pack prints as a Letter PDF the family can use at home, with no app and no login needed to read it.</p>
          </div>
        </div>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>How AI works in Flockpath</h2>
        <p>Yes, this tool uses AI, and only in one place: drafting the week&apos;s devotionals. The pastor picks where that writing happens. With Local, a small language model runs on the pastor&apos;s own computer, not on a server. With OpenRouter, Grok, or Google, the writing happens through that provider&apos;s service, using the pastor&apos;s own key, and the passage text goes to that provider. It writes the adult devotionals, the kid retellings, the leader questions, and the prayers, one day at a time, from the pastor&apos;s confirmed passage.</p>
        <p>What the AI never does is just as important:</p>
        <ul>
          <li>It never writes Scripture. The model returns verse references only, and code fills every quote from the public-domain Berean Standard Bible store, word for word.</li>
          <li>It never picks the passage. The pastor gives the sermon, the verse list, or the topic, and confirms the five verses before anything is drafted.</li>
          <li>It never publishes. The draft stops for the pastor&apos;s review, and nothing locks, prints, or shares until the pastor taps Approve and Lock.</li>
          <li>It never sees family data. Only the passage the pastor gives is sent to the writing model, and with Local it never leaves the pastor&apos;s computer. No family data is collected, and there are no ads in a pack.</li>
        </ul>
        <p>Two automatic checks run as the pastor edits: Scripture exactness (every quote matches the verse store character for character) and originality (five different days, not one day said five times). Anything that fails must be fixed, or that section left out, before the pack can lock.</p>
      </section>

      <section className="fp-about-card">
        <h2 style={{ marginTop: 0 }}>Safeguards, in plain language</h2>
        <ul>
          <li>Scripture is retrieved from the BSB store, never written by the model, and every quote is checked character for character before locking.</li>
          <li>Kid versions are labeled retellings, never presented as Scripture.</li>
          <li>Generation happens where the pastor chose: on the pastor&apos;s own computer with Local, or through the provider&apos;s service with OpenRouter, Grok, or Google, using the pastor&apos;s own key. No family data is collected, and there are no ads in a pack.</li>
          <li>Every hymn is public domain in the US in music, setting, words, and translation, with the setting named.</li>
        </ul>
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
