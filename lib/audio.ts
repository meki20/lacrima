export const LANGS = [
  { id: "ja", label: "Japanese" },
  { id: "en", label: "English" },
  { id: "it", label: "Italian" },
  { id: "de", label: "German" },
  { id: "fr", label: "French" },
  { id: "es", label: "Spanish" },
  { id: "pt", label: "Portuguese" },
  { id: "hi", label: "Hindi" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
  { id: "ru", label: "Russian" },
] as const;

export type Lang = (typeof LANGS)[number]["id"];

const IDS = new Set<string>(LANGS.map((l) => l.id));

/** Accepts a query/storage value, including the old sub/dub keys. */
export function parseLang(raw: string | null | undefined): Lang | undefined {
  if (!raw) return undefined;
  if (raw === "sub") return "ja";
  if (raw === "dub") return "en";
  return IDS.has(raw) ? (raw as Lang) : undefined;
}

/** ISO / player labels that mean this spoken language. */
const ALIASES: Record<Lang, string[]> = {
  ja: ["ja", "jpn", "jp", "japanese"],
  en: ["en", "eng", "english"],
  it: ["it", "ita", "italian", "italiano"],
  de: ["de", "deu", "ger", "german", "deutsch"],
  fr: ["fr", "fra", "fre", "french"],
  es: ["es", "spa", "spanish", "castellano"],
  pt: ["pt", "por", "portuguese", "brazilian"],
  hi: ["hi", "hin", "hindi"],
  ko: ["ko", "kor", "korean"],
  zh: ["zh", "chi", "zho", "chinese", "mandarin"],
  ru: ["ru", "rus", "russian"],
};

/** Accepts `eng`, `en-US`, `Japanese`, or a stored lang id. */
export function parseLangToken(raw: string | null | undefined): Lang | undefined {
  if (!raw) return undefined;
  const direct = parseLang(raw);
  if (direct) return direct;
  const lower = raw.toLowerCase().trim();
  const base = lower.split(/[-_]/)[0] ?? lower;
  const token = base.replace(/[^a-z]/g, "");
  if (!token) return undefined;
  for (const lang of Object.keys(ALIASES) as Lang[]) {
    if (ALIASES[lang].includes(token) || ALIASES[lang].includes(lower)) return lang;
  }
  return parseLang(base);
}

const TOKENS: { lang: Lang; re: RegExp }[] = [
  { lang: "it", re: /\b(italiano|italian|ita)\b|🇮🇹/i },
  { lang: "de", re: /\b(deutsch|german|ger)\b|🇩🇪/i },
  { lang: "fr", re: /\b(french|fran[cç]ais|vostfr|vost|vfq|vff|\bvf\b)\b|🇫🇷/i },
  { lang: "es", re: /\b(spanish|espa[nñ]ol|castellano|latino|latam)\b|🇪🇸|🇲🇽/i },
  { lang: "pt", re: /\b(portugu[eê]s|brazilian|dublado|pt[\s._-]?br)\b|🇧🇷|🇵🇹/i },
  { lang: "ru", re: /\b(russian|rus)\b|🇷🇺/i },
  { lang: "ko", re: /\b(korean|kor)\b|🇰🇷/i },
  { lang: "zh", re: /\b(chinese|mandarin|cantonese)\b|🇨🇳/i },
  /*
   * Hindi was the one language with no flag, only its own name.
   *
   * 4KHDHub-sourced releases label themselves `🇮🇳🇬🇧🇯🇵` — Hindi, English,
   * Japanese — and with 🇮🇳 unreadable that reads as a plain ja+en dual, so the
   * "classic dual audio" rule filed it under Japanese *and* English. It is neither:
   * Chrome exposes no `audioTracks`, so the file plays whichever track it defaults
   * to, and for these releases that is Hindi. Recognising the flag lets the
   * existing "Hindi alongside anything else means Hindi" rule do its job.
   */
  { lang: "hi", re: /\b(hindi|hin)\b|🇮🇳/i },
  { lang: "en", re: /\b(english|eng)\b|🇬🇧|🇺🇸/i },
  { lang: "ja", re: /\b(japanese|jap|jpn)\b|🇯🇵/i },
];

const DUAL = /\bdual(?:dub)?\b|\bdual[\s._-]?audio\b|\bmulti[\s._-]?audio\b/i;
const MULTI = /\bmulti\b/i;
const DUB = /\bdub(?:bed)?\b/i;
const SUB = /\b(?:soft[\s._-]?|hard[\s._-]?)?sub(?:bed|s)?\b|\bsubbed\b|\bvostfr\b/i;
const EXPLICIT_AUDIO =
  /🎧\s*Audio:\s*(Japanese|English|Hindi|Italian|German|French|Spanish|Portuguese|Korean|Chinese|Russian)/i;

const EXPLICIT_WORD: Record<string, Lang> = {
  japanese: "ja",
  english: "en",
  hindi: "hi",
  italian: "it",
  german: "de",
  french: "fr",
  spanish: "es",
  portuguese: "pt",
  korean: "ko",
  chinese: "zh",
  russian: "ru",
};

/**
 * TorrentClaw (and similar) put spoken flags after 🔊 and subtitle flags after 💬.
 * Reading the whole blob treated 🇺🇸 subs as English audio.
 *
 * They are not always on separate lines — the live format is a single line,
 * `🔊 aac · 2.0 · 🇯🇵 💬 🇺🇸 💾 187.8 GB` — so stopping at the newline swallowed
 * the subtitle flags anyway, and every Japanese release with English subs was
 * offered as English audio too. Stop at 💬 itself, wherever it sits.
 */
function spokenText(text: string): string {
  const audio = /🔊[^\n💬]*/u.exec(text);
  if (audio) return audio[0];
  return text.replace(/💬[^\n]*/gu, "");
}

/** Subtitle languages advertised after TorrentClaw's `💬` marker. */
export function subtitleLangs(text: string): Lang[] {
  const marked = /💬([^\n💾🏷]*)/u.exec(text)?.[1];
  if (marked) return namedLangs(marked);
  if (/\benglish[\s._-]?subs?\b|\beng[\s._-]?subs?\b/i.test(text)) return ["en"];
  return [];
}

function namedLangs(text: string): Lang[] {
  const named: Lang[] = [];
  for (const { lang, re } of TOKENS) {
    if (re.test(text) && !named.includes(lang)) named.push(lang);
  }
  return named;
}

function isMulti(text: string, spoken: string): boolean {
  return DUAL.test(spoken) || MULTI.test(text);
}

function explicitAudioLang(text: string): Lang | null {
  const m = EXPLICIT_AUDIO.exec(text);
  if (!m) return null;
  return EXPLICIT_WORD[m[1].toLowerCase()] ?? null;
}

/** Languages named on the listing — used to pick an audio track inside a file. */
export function trackLangs(text: string): Lang[] {
  const spoken = spokenText(text);
  const explicit = explicitAudioLang(text);
  if (explicit) return [explicit];

  const multi = isMulti(text, spoken);
  const named = multi
    ? [...new Set([...namedLangs(spoken), ...namedLangs(text)])]
    : namedLangs(spoken);

  if (named.includes("hi") && named.length > 1) return ["hi"];
  if (DUAL.test(spoken)) return ["ja", "en"];
  if (named.includes("ja") && named.includes("en") && named.length === 2) return ["ja", "en"];
  if (named.length > 1 && named.includes("ja") && !named.includes("en")) {
    return named.filter((l) => l !== "ja");
  }
  if (DUB.test(spoken)) return named.length ? named : ["en"];
  if (SUB.test(spoken)) return ["ja"];
  if (multi && /4khdhub/i.test(text) && !namedLangs(spoken).includes("ja")) return ["hi"];
  if (multi && named.length) return named;
  if (multi) return ["ja", "en"];
  return named.length ? named : ["ja"];
}

/**
 * Which quality × language menu rows a listing belongs in.
 * A file can name several langs but only belong in buckets where it is a fair default.
 */
export function bucketLangs(text: string): Lang[] {
  const spoken = spokenText(text);
  const explicit = explicitAudioLang(text);
  if (explicit) return [explicit];

  const multi = isMulti(text, spoken);
  const named = multi
    ? [...new Set([...namedLangs(spoken), ...namedLangs(text)])]
    : namedLangs(spoken);

  /*
   * Every language the file names, not a guess at which one it defaults to.
   *
   * This used to collapse hard: a file naming Hindi alongside anything else became
   * Hindi-only, 🇮🇹🇯🇵 dropped its Japanese, and 4KHDHub MULTi releases were forced
   * to Hindi whatever they said. Every one of those rules was working around the
   * same missing capability — the browser plays the *first* audio track and offers
   * no way to change it, so naming a language we could not actually deliver was a
   * lie. The relay now selects the track with ffmpeg, so a file carrying `hin`,
   * `eng` and `jpn` genuinely serves all three, and saying so is the truth rather
   * than an over-promise.
   */
  if (DUAL.test(spoken)) return ["ja", "en"];
  if (DUB.test(spoken)) return named.length ? named : ["en"];
  /* "English sub" is Japanese audio; the English is on the subtitle track. */
  if (SUB.test(spoken)) return ["ja"];
  if (named.length) return named;
  return multi ? ["ja", "en"] : ["ja"];
}

/** @deprecated alias — use bucketLangs for menus, trackLangs for audio tracks. */
export function claimedLangs(text: string): Lang[] {
  return trackLangs(text);
}

/** Whether this listing belongs in the language bucket the user picked. */
export function speaksLang(text: string, want: Lang): boolean {
  return bucketLangs(text).includes(want);
}

function tokensOf(language: string, label: string): string[] {
  return `${language} ${label}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

export function trackSpeaks(language: string, label: string, lang: Lang): boolean {
  const tokens = tokensOf(language, label);
  return ALIASES[lang].some((a) => tokens.includes(a));
}

/**
 * Which audio track to enable for `lang`.
 * `null` — no labels, leave the file alone.
 * `-1` — labels exist and none match: this is the wrong language, fail over.
 */
export function pickAudioTrack(
  tracks: { language?: string; label?: string }[],
  lang: Lang,
  hint = "",
): number | null | -1 {
  if (!tracks.length) return null;
  const labelled = tracks.some((t) => {
    const language = (t.language ?? "").toLowerCase();
    return (language && language !== "und" && language !== "unk") || Boolean(t.label);
  });
  if (labelled) {
    const i = tracks.findIndex((t) => trackSpeaks(t.language ?? "", t.label ?? "", lang));
    return i >= 0 ? i : -1;
  }
  if (!hint) return null;
  const langs = trackLangs(hint);
  if (langs.length === 1) {
    if (langs[0] === lang) return langs[0] === "hi" && tracks.length >= 2 ? 0 : null;
    return -1;
  }
  /* Dual ja+en with no track labels: Japanese is usually track 0, English track 1. */
  if (langs.includes("ja") && langs.includes("en") && tracks.length >= 2) {
    if (lang === "ja") return 0;
    if (lang === "en") return 1;
  }
  if (lang === "hi" && langs.includes("hi") && tracks.length >= 1) return 0;
  return null;
}
