// Nov 11, 2026, v53, Phase 3 Spanish v1: the translation table.
// One place that knows which verse store, which language, and
// which display name each translation code means. The pack
// carries both `language` ("en" | "es") and `translation`
// ("bsb" | "rv1909" | "spabes"); the language drives prompts,
// UI strings, and PDF strings, the translation drives the
// verse store and the credit line. English packs have
// translation "bsb" and language "en"; Spanish packs have
// language "es" and translation "rv1909" or "spabes".
// RVR1960 is copyrighted and must never be stored or shipped;
// it is deliberately absent from this table, so no code path
// can select it by accident.
export const TRANSLATIONS = {
  bsb: {
    code: "bsb",
    language: "en",
    prefix: "bsb",
    name: "Berean Standard Bible",
    short: "BSB",
    credit: "Berean Standard Bible",
  },
  rv1909: {
    code: "rv1909",
    language: "es",
    prefix: "rv1909",
    name: "Reina-Valera 1909",
    short: "RV1909",
    credit: "Reina-Valera 1909",
  },
  spabes: {
    code: "spabes",
    language: "es",
    prefix: "spabes",
    name: "La Biblia en Español Sencillo 2026",
    short: "Español Sencillo",
    // Public domain, 2026 2nd edition. Credited as a courtesy,
    // never labeled CC BY 4.0: that license covers the
    // 2018/2019 editions, not the 2026 edition (Jeremiah's
    // call, Nov 11, 2026).
    credit: "La Biblia en Español Sencillo 2026 (traducción por AudioBiblia.org, editado por Irma Flores)",
  },
};

export function translationFor(code) {
  return TRANSLATIONS[String(code ?? "").toLowerCase()] ?? TRANSLATIONS.bsb;
}

export function languageForTranslation(code) {
  return translationFor(code).language;
}

export function languageForPack(pack) {
  if (!pack) return "en";
  if (pack.language === "es" || pack.language === "en") return pack.language;
  return languageForTranslation(pack.translation);
}

export function isSpanishPack(pack) {
  return languageForPack(pack) === "es";
}

// Nov 18, 2026: hymn meter values come from Hymn Desk data and
// carry English wording ("Not stated on source pages", "with
// refrain", "with alleluia"). The numeric part (8.7.8.7, "D")
// is language-free, so a Spanish pack only needs the words
// translated. English packs pass through untouched. Keep the
// match list to the exact phrases Hymn Desk data carries, so
// a real numeric meter is never rewritten.
const METER_ES_WORDS = [
  ["Not stated on source pages", "No indicado en las fuentes"],
  ["with refrain", "con estribillo"],
  ["with alleluia", "con aleluya"],
];

export function formatMeter(meter, language) {
  const m = String(meter ?? "");
  if (language !== "es") return m;
  let out = m;
  for (const [en, es] of METER_ES_WORDS) {
    out = out.split(en).join(es);
  }
  return out;
}
