// Coloring library v1, Nov 1, 2026: 10 pre-rendered PNG themes.
// Batch 2, Nov 2, 2026: 10 more themes, total 20.
// Batch 3, Nov 9, 2026: 10 more themes, total 30.
// Deterministic matcher, NO model choice at runtime. The tool
// matches by passage, refs, and topics (like the hymn matcher),
// and the pastor previews and swaps on the review page.
// The PNGs were rendered on the Mac (Draw Things,
// Z-Image-Turbo), downloaded from the Drive loading dock
// flockpath-coloring folder, upscaled to 2550 px wide for
// Letter print, and passed scripts/check_coloring.py.
// Eye QA: outline only, no text or letters, no
// Jesus, scenes match their themes, simple for ages 6-10.
// Known deviation from COLORING-10.md: 6 of the batch 1 renders
// carry a border frame inside the image (creation-sky-sea,
// hope-anchor, prayer-bible, water-fish, garden-fruit,
// star-night), although the spec said no border frame.
// The frame prints as a coloring-book page border, not a
// defect for a child, so the renders shipped as-is; if
// Jeremiah wants them frameless, those 6 are re-rendered
// or cropped, not silently edited.
// Batch 2 notes, Nov 2, 2026: rainbow-promise, sunrise-morning,
// and mountain-strength also carry a border frame, same
// closed decision. mountain-strength peaks have no snow caps
// although the prompt asked for them; it ships as a mountain
// scene. tomb-empty v1 rendered as an upright headstone and
// failed QA; v3 (positive-only, "1st century rock-cut") is
// the shipped version: rock hillside, open doorway, round
// stone beside the doorway.
// Batch 3 notes, Nov 9, 2026: well-water v3 was accepted by
// Jeremiah ("isnt perfect but Im going to call it good") — the
// water is a white oval with wavy lines, gray 3.06% at render
// size, 3.26% upscaled, under the 5% gate. tablets-stone v3
// shows Moses holding the tablets (Jeremiah's idea after v1
// and v2 both read as gravestones); simple face like the angel,
// hands hold the tablets, not the main subject. cross-hill
// (plain wooden cross on a hill) has no matcher rule yet —
// see the note at the batch 3 rules in matchColoring.
// The old SVG templates (creation-sky-earth-v1, etc.) were
// deleted Nov 1, 2026, once all 10 PNGs were live, per
// COLORING-10.md. A pack that still names an old SVG id
// falls back to the matcher in build-pdf.mjs and ReviewPage.
// svgTemplateId is a historic field name; its values are
// now PNG template ids, not SVG ids.
export const COLORING_TEMPLATES = {
  "creation-sky-sea": {
    file: "creation-sky-sea.png",
    alt: "Coloring outline: sky, sun, land, and sea",
    caption: "Color the sky, sun, land, and sea.",
  },
  "shepherd-sheep": {
    file: "shepherd-sheep.png",
    alt: "Coloring outline: a shepherd, sheep, and hills",
    caption: "Color the shepherd, the sheep, and the hills.",
  },
  "cross-heart": {
    file: "cross-heart.png",
    alt: "Coloring outline: a cross and a heart",
    caption: "Color the cross and the heart. God's love never ends.",
  },
  "hope-anchor": {
    file: "hope-anchor.png",
    alt: "Coloring outline: an anchor and the sea",
    caption: "Color the anchor and the sea. Hope holds firm.",
  },
  "faith-seed": {
    file: "faith-seed.png",
    alt: "Coloring outline: a little plant growing from a seed",
    caption: "Color the little plant growing from a seed.",
  },
  "prayer-bible": {
    file: "prayer-bible.png",
    alt: "Coloring outline: an open book and a candle",
    caption: "Color the open book and the candle.",
  },
  "light-lamp": {
    file: "light-lamp.png",
    alt: "Coloring outline: a lamp and its light",
    caption: "Color the lamp and its light.",
  },
  "water-fish": {
    file: "water-fish.png",
    alt: "Coloring outline: a basket, bread, and fish",
    caption: "Color the basket, the bread, and the fish.",
  },
  "garden-fruit": {
    file: "garden-fruit.png",
    alt: "Coloring outline: a garden and its fruit",
    caption: "Color the garden and its fruit.",
  },
  "star-night": {
    file: "star-night.png",
    alt: "Coloring outline: a star and the night sky",
    caption: "Color the star and the night sky.",
  },
  "dove-peace": {
    file: "dove-peace.png",
    alt: "Coloring outline: a dove with an olive branch",
    caption: "Color the dove flying in the sky.",
  },
  "rainbow-promise": {
    file: "rainbow-promise.png",
    alt: "Coloring outline: a rainbow over hills",
    caption: "Color the rainbow over the hills.",
  },
  "tree-life": {
    file: "tree-life.png",
    alt: "Coloring outline: a big tree with fruit",
    caption: "Color the big tree and its fruit.",
  },
  "harvest-wheat": {
    file: "harvest-wheat.png",
    alt: "Coloring outline: wheat and a basket",
    caption: "Color the wheat and the basket.",
  },
  "boat-storm": {
    file: "boat-storm.png",
    alt: "Coloring outline: a boat on waves",
    caption: "Color the boat on the waves.",
  },
  "sunrise-morning": {
    file: "sunrise-morning.png",
    alt: "Coloring outline: a sunrise over hills",
    caption: "Color the sunrise over the hills.",
  },
  "bread-cup": {
    file: "bread-cup.png",
    alt: "Coloring outline: bread and a cup on a table",
    caption: "Color the bread and the cup on the table.",
  },
  "mountain-strength": {
    file: "mountain-strength.png",
    alt: "Coloring outline: mountains and a path",
    caption: "Color the mountains and the path.",
  },
  "tomb-empty": {
    file: "tomb-empty.png",
    alt: "Coloring outline: a garden tomb and a round stone",
    caption: "Color the garden tomb and the stone.",
  },
  "crown-glory": {
    file: "crown-glory.png",
    alt: "Coloring outline: a crown and stars",
    caption: "Color the crown and the stars.",
  },
  "cross-hill": {
    file: "cross-hill.png",
    alt: "Coloring outline: a cross on a hill",
    caption: "Color the cross on the hill.",
  },
  "lamb-gentle": {
    file: "lamb-gentle.png",
    alt: "Coloring outline: a gentle lamb in a meadow",
    caption: "Color the gentle lamb in the meadow.",
  },
  "ark-noah": {
    file: "ark-noah.png",
    alt: "Coloring outline: an ark on waves",
    caption: "Color the ark on the waves.",
  },
  "manger-stable": {
    file: "manger-stable.png",
    alt: "Coloring outline: a manger in a stable",
    caption: "Color the manger in the stable.",
  },
  "church-steeple": {
    file: "church-steeple.png",
    alt: "Coloring outline: a church with a steeple",
    caption: "Color the church with its steeple.",
  },
  "vine-branches": {
    file: "vine-branches.png",
    alt: "Coloring outline: a vine and its grapes",
    caption: "Color the vine and its grapes.",
  },
  "well-water": {
    file: "well-water.png",
    alt: "Coloring outline: a well and its bucket",
    caption: "Color the well and its bucket.",
  },
  "shield-faith": {
    file: "shield-faith.png",
    alt: "Coloring outline: a shield and its cross",
    caption: "Color the shield and its cross.",
  },
  "tablets-stone": {
    file: "tablets-stone.png",
    alt: "Coloring outline: Moses holding two stone tablets",
    caption: "Color Moses and the two stone tablets.",
  },
  "angel-messenger": {
    file: "angel-messenger.png",
    alt: "Coloring outline: an angel and its star",
    caption: "Color the angel and its star.",
  },
};

export function matchColoring(pack) {
  const refs = (pack.adultDevotionals ?? []).map((d) => d.scripture?.reference ?? "");
  const passage = String(pack.passage ?? "");
  const topics = String(pack.topics ?? "");
  const text = (passage + " " + refs.join(" ") + " " + topics).toLowerCase();
  const has = (...words) => words.some((w) => text.includes(w));
  // Most specific first, same order as the old SVG matcher
  // for shepherd / love / Genesis, so old packs keep their
  // theme when they move to PNGs.
  if (refs.some((r) => r.startsWith("PSA 23")) || has("shepherd", "pasture")) {
    return "shepherd-sheep";
  }
  // Batch 2 themes, Nov 2, 2026. These words are distinctive
  // topic words, so they sit before the broader batch 1 rules;
  // a pack whose topic is only "love" or "hope" still gets
  // its batch 1 theme, because those words are not listed here.
  if (has("resurrection", "empty tomb", "easter", "tomb")) {
    return "tomb-empty";
  }
  if (has("crown", "kingdom", "glory")) {
    return "crown-glory";
  }
  if (has("mountain", "climb")) {
    return "mountain-strength";
  }
  if (has("storm")) {
    return "boat-storm";
  }
  if (has("dove")) {
    return "dove-peace";
  }
  if (has("rainbow", "covenant")) {
    return "rainbow-promise";
  }
  if (has("tree of life")) {
    return "tree-life";
  }
  if (has("wheat")) {
    return "harvest-wheat";
  }
  if (has("sunrise", "morning")) {
    return "sunrise-morning";
  }
  if (has("cup", "communion")) {
    return "bread-cup";
  }
  // Batch 3 themes, Nov 9, 2026. These words are distinctive
  // topic words, so they sit before the broader batch 1 rules,
  // same as batch 2. cross-hill has NO rule here on purpose:
  // it is available on the Review page swap, and the "cross"
  // word below routes to cross-heart, which is the cross page
  // for a pack whose topic names the cross.
  if (has("lamb", "passover")) {
    return "lamb-gentle";
  }
  if (has("ark", "noah", "flood")) {
    return "ark-noah";
  }
  if (has("manger", "stable", "bethlehem")) {
    return "manger-stable";
  }
  if (has("church", "steeple", "worship")) {
    return "church-steeple";
  }
  if (has("vine", "branches", "grapes", "abiding")) {
    return "vine-branches";
  }
  if (has("well", "living water", "thirst", "samaritan")) {
    return "well-water";
  }
  if (has("shield", "armor", "protection")) {
    return "shield-faith";
  }
  if (has("tablets", "commandments", "moses", "sinai")) {
    return "tablets-stone";
  }
  if (has("angel", "messenger", "wings")) {
    return "angel-messenger";
  }
  // Nov 9, 2026, coloring fix (v48): "cross" routes to
  // cross-heart. A pack whose topic names the cross gets a
  // cross page, even when one of its verses is Genesis (the
  // Genesis check below used to win, so a cross pack with a
  // Garden verse got a creation picture).
  if (has("cross", "love", "grace", "salvation") || passage.includes("Romans") || passage.includes("John")) {
    return "cross-heart";
  }
  if (passage.includes("Genesis") || refs.some((r) => r.startsWith("GEN"))) {
    return "creation-sky-sea";
  }
  if (has("hope", "anchor", "promise", "endurance", "refuge")) {
    return "hope-anchor";
  }
  if (has("faith", "growth", "seed", "mustard", "trust")) {
    return "faith-seed";
  }
  if (has("prayer", "bible", "quiet", "reading")) {
    return "prayer-bible";
  }
  if (has("light", "lamp", "darkness", "shining", "guide")) {
    return "light-lamp";
  }
  if (has("fish", "bread", "sharing", "provision")) {
    return "water-fish";
  }
  if (has("garden", "fruit", "harvest", "eden")) {
    return "garden-fruit";
  }
  if (has("star", "night", "journey", "christmas")) {
    return "star-night";
  }
  // creation-sky-sea's caption is generic (no Genesis 1),
  // so it is a safe fallback for every other pack.
  return "creation-sky-sea";
}
