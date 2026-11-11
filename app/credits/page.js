export default function Credits() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Flockpath credits: open source, free</h1>
      <p>Flockpath is built only from free, open-source software and public-domain or openly licensed data. No paid AI API, no per-token cost, no per-seat SaaS. The full audit lives in the app&apos;s OPEN-SOURCE.md.</p>
      <h2>Software</h2>
      <p>Next.js, React, Zod, and qrcode (all MIT); Node.js (MIT) with SQLite (public domain); llama.cpp (MIT) for local model inference; Typst (Apache 2.0) for PDFs; pypdf (BSD-3-Clause) for PDF upload; usfm2dict (MIT, SIL International) for Bible ingestion; DejaVu and Liberation fonts (free, SIL OFL for Liberation).</p>
      <h2>Model</h2>
      <p>Qwen3.5-4B, Apache 2.0, run locally with llama.cpp. No data is sent to any AI provider, and no API key is needed.</p>
      <h2>Scripture</h2>
      <p>Berean Standard Bible, dedicated to the public domain (CC0) Apr 30, 2023, and other public-domain translations per edition. No modern copyrighted translation is ever used.</p>
      <h2>Study sources</h2>
      <p>Commentaries, devotionals, and dictionaries in the public domain by age (Matthew Henry, Jamieson-Fausset-Brown, Barnes, Gill, Clarke, Calvin, Keil and Delitzsch, Spurgeon, Easton, ISBE, Nave, Torrey, My Utmost for His Highest 1927 original, and others); cross-references from the Treasury of Scripture Knowledge, public domain.</p>
      <h2>Attribution required by CC BY 4.0</h2>
      <p>Lexicon definitions and interlinear word glosses may come from STEPBible and OpenScriptures data, which are free and commercial-use allowed under CC BY 4.0, with this attribution:</p>
      <p>STEPBible lexicon and interlinear data (TAGNT, TAHOT, TBESH, TBESG, TFLSJ), Tyndale House, Cambridge, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Source: https://github.com/STEPBible/STEPBible-Data, www.STEPBible.org.</p>
      <p>Brown-Driver-Briggs Hebrew lexicon XML transcription by the Open Scriptures Hebrew Bible Project, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).</p>
      <h2>Hymns</h2>
      <p>Every hymn is public domain in the US in music, setting, words, and translation, with the setting named explicitly. No CCLI songs, no modern arrangements.</p>
      <h2>Flockpath name and logo</h2>
      <p>Flockpath code is released under the MIT License. The Flockpath name, wordmark, and logo are trademarks of Dexia Digi and are not covered by that license. A fork or derivative must use its own name and branding.</p>
      <p><a href="/">Back to Flockpath</a></p>
    </main>
  );
}
