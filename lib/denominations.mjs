// Denomination setting for Flockpath, Nov 2, 2026.
//
// This module is client-safe: no Node imports, so the sign-in page
// (a client component) and the server routes can both use it.
// The setting is a PRESET for general voices: it orders the
// voices the generation bundle puts first. For opt-in voices
// it IS a wall (Nov 16, 2026, v57 hard filter): a voice marked
// opt-in in Phos appears only for a pastor who opted into that
// tradition, and never in another pastor's pack. Nothing enters
// a pack unlabeled.
//
// What the preset actually changes today (this build): the order
// of commentary sources (max 2 per verse) and anchored devotionals
// (max 5) in the Phos bundle, via scripts/phos_context.py. The
// non-denominational default keeps today's order exactly.
// Dictionary, encyclopedia, and liturgy voices are NOT in the
// bundle yet (PHOS-USE-IN-PACKS.md, queued), so presets whose
// voices live only there (Congregational, Anglican liturgy) say
// so plainly in their message instead of promising an effect
// that does not exist yet.
//
// Privacy, stated the same way for every option: the choice is
// stored only in the local auth database on the pastor's own
// computer. It is never sent anywhere, and it never appears in
// a pack or PDF.

export const PRIVACY_SENTENCE =
  "This choice is stored only on your computer. It is never sent anywhere, and it never appears in a pack or PDF.";

// Nov 21, 2026, v63 round 2: the Spanish side of the
// denomination messages, for the tradition card on My
// packs. The stored values stay the English keys; only
// the displayed message and the dropdown labels change.
// Spanish is new and unreviewed, like the Spanish pack
// text since v53.
export const PRIVACY_SENTENCE_ES =
  "Esta elección se guarda solo en tu computadora. Nunca se envía a ningún lugar, y nunca aparece en un paquete o PDF.";

export const DENOMINATION_MESSAGES_ES = {
  "non-denominational":
    "Tus paquetes empezarán con voces ampliamente compartidas: JFB y Henry para comentarios, y el devocional clásico elegido de los devocionales anclados. Cada fuente está etiquetada en la revisión, y puedes cambiar las voces de cualquier paquete.",
  baptist:
    "Tus paquetes pondrán primero a Gill y Spurgeon, y Treasury of David primero para los paquetes de Salmos. Todo lo demás sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes. Puedes cambiar las voces de cualquier paquete.",
  presbyterian:
    "Tus paquetes pondrán primero a Barnes, Henry y Calvin. Todo lo demás sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes. Puedes cambiar las voces de cualquier paquete.",
  methodist:
    "Tus paquetes pondrán primero a Clarke. Todo lo demás sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes. Puedes cambiar las voces de cualquier paquete.",
  lutheran:
    "Tus paquetes pondrán primero a Keil y Delitzsch para los paquetes del Antiguo Testamento. Todo lo demás sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes. Puedes cambiar las voces de cualquier paquete.",
  reformed:
    "Tus paquetes pondrán primero a Calvin. Todo lo demás sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes. Puedes cambiar las voces de cualquier paquete.",
  congregational:
    "Aún no hay comentarios ni devocionales congregacionales en la biblioteca, así que tus paquetes usarán por ahora el conjunto inicial no denominacional. Hitchcock y Sanford's Concise encabezarán la capa de fondo cuando se publiquen. Todo sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes.",
  anglican:
    "Tus paquetes pondrán primero a Jamieson, Fausset y Brown, el comentario con una voz anglicana. El Libro de Oración Común sigue siendo solo opcional, nunca automático. Todo lo demás sigue disponible y etiquetado en la revisión, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes. Puedes cambiar las voces de cualquier paquete.",
  catholic:
    "Dos extras están ahora activados para ti: la Imitación de Cristo y la Práctica de la Presencia se unen a la rotación del devocional clásico. Nada más cambia. Tus Escrituras siguen siendo BSB con 66 libros, el verificador y el bloqueo funcionan igual, y todas las demás voces siguen disponibles y etiquetadas en la revisión.",
  other:
    "Tus paquetes usarán el conjunto inicial no denominacional, y cada voz sigue disponible y etiquetada en la revisión para cualquier paquete, excepto las voces opcionales de otras tradiciones, que nunca aparecen en tus paquetes.",
};

export const DENOMINATIONS = [
  { key: "non-denominational", label: "Non-denominational (default)" },
  { key: "baptist", label: "Baptist" },
  { key: "presbyterian", label: "Presbyterian" },
  { key: "methodist", label: "Methodist" },
  { key: "lutheran", label: "Lutheran" },
  { key: "reformed", label: "Reformed" },
  { key: "congregational", label: "Congregational" },
  { key: "anglican", label: "Anglican" },
  { key: "catholic", label: "Catholic" },
  { key: "other", label: "Other / prefer not to say" },
];

export const DENOMINATION_KEYS = DENOMINATIONS.map((d) => d.key);

export function isDenomination(key) {
  return DENOMINATION_KEYS.includes(key);
}

export function denominationLabel(key) {
  return (DENOMINATIONS.find((d) => d.key === key) ?? DENOMINATIONS[0]).label;
}

// The few adjustments each option makes, in the pastor's own
// words on the signup screen. Wording approved in shape Nov 2,
// 2026; Congregational, Anglican, and default wording corrected
// in this build to match what the bundle preset actually does.
export const DENOMINATION_MESSAGES = {
  "non-denominational":
    "Your packs will start with widely shared voices: JFB and Henry for commentary, and the classic devotional chosen from the anchored devotionals. Every source is labeled in review, and you can change the voices for any pack.",
  baptist:
    "Your packs will put Gill and Spurgeon first, and Treasury of David first for Psalm packs. Everything else stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs. You can change the voices for any pack.",
  presbyterian:
    "Your packs will put Barnes, Henry, and Calvin first. Everything else stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs. You can change the voices for any pack.",
  methodist:
    "Your packs will put Clarke first. Everything else stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs. You can change the voices for any pack.",
  lutheran:
    "Your packs will put Keil and Delitzsch first for Old Testament packs. Everything else stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs. You can change the voices for any pack.",
  reformed:
    "Your packs will put Calvin first. Everything else stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs. You can change the voices for any pack.",
  congregational:
    "No Congregational commentary or devotional is in the library yet, so your packs will use the non-denominational starting set for now. Hitchcock and Sanford's Concise will lead the background layer when it ships. Everything stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs.",
  anglican:
    "Your packs will put Jamieson, Fausset and Brown first, the commentary with an Anglican voice in it. The Book of Common Prayer stays opt-in only, never automatic. Everything else stays available and labeled in review, except opt-in voices from other traditions, which never appear in your packs. You can change the voices for any pack.",
  catholic:
    "Two extras are now on for you: the Imitation of Christ and Practice of the Presence join the classic devotional rotation. Nothing else changes. Your Scripture stays BSB with 66 books, the verifier and lock work the same, and every other voice stays available and labeled in review.",
  other:
    "Your packs will use the non-denominational starting set, and every voice stays available and labeled in review for any pack, except opt-in voices from other traditions, which never appear in your packs.",
};

// lang defaults to English, so the sign-in page and the
// /api/me saved message keep their English wording; the
// tradition card passes the app language for "es".
export function denominationMessage(key, lang = "en") {
  const k = isDenomination(key) ? key : "non-denominational";
  if (lang === "es") return `${DENOMINATION_MESSAGES_ES[k]} ${PRIVACY_SENTENCE_ES}`;
  return `${DENOMINATION_MESSAGES[k]} ${PRIVACY_SENTENCE}`;
}
