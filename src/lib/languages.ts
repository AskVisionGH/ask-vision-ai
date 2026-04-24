// Language preference for AI replies + voice transcription.
// "auto" lets the model mirror the user's input language and ElevenLabs auto-detect.
export type LanguageCode =
  | "auto"
  | "en"
  | "es"
  | "fr"
  | "de"
  | "it"
  | "pt"
  | "nl"
  | "ja"
  | "ko"
  | "zh"
  | "ar"
  | "hi"
  | "ru"
  | "tr"
  | "pl";

export interface LanguageOption {
  /** Stored value (BCP-47 / "auto"). */
  value: LanguageCode;
  /** Label shown in the picker. */
  label: string;
  /** Native-name hint, displayed alongside the label. */
  native: string;
  /** ISO 639-3 code for ElevenLabs Scribe (`null` for auto-detect). */
  iso639_3: string | null;
  /** Human-readable name we pass to the AI for reply enforcement. */
  englishName: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "auto", label: "Auto-detect", native: "Mirror my language", iso639_3: null, englishName: "the user's input language" },
  { value: "en", label: "English", native: "English", iso639_3: "eng", englishName: "English" },
  { value: "es", label: "Spanish", native: "Español", iso639_3: "spa", englishName: "Spanish" },
  { value: "fr", label: "French", native: "Français", iso639_3: "fra", englishName: "French" },
  { value: "de", label: "German", native: "Deutsch", iso639_3: "deu", englishName: "German" },
  { value: "it", label: "Italian", native: "Italiano", iso639_3: "ita", englishName: "Italian" },
  { value: "pt", label: "Portuguese", native: "Português", iso639_3: "por", englishName: "Portuguese" },
  { value: "nl", label: "Dutch", native: "Nederlands", iso639_3: "nld", englishName: "Dutch" },
  { value: "ja", label: "Japanese", native: "日本語", iso639_3: "jpn", englishName: "Japanese" },
  { value: "ko", label: "Korean", native: "한국어", iso639_3: "kor", englishName: "Korean" },
  { value: "zh", label: "Chinese", native: "中文", iso639_3: "zho", englishName: "Chinese (Simplified)" },
  { value: "ar", label: "Arabic", native: "العربية", iso639_3: "ara", englishName: "Arabic" },
  { value: "hi", label: "Hindi", native: "हिन्दी", iso639_3: "hin", englishName: "Hindi" },
  { value: "ru", label: "Russian", native: "Русский", iso639_3: "rus", englishName: "Russian" },
  { value: "tr", label: "Turkish", native: "Türkçe", iso639_3: "tur", englishName: "Turkish" },
  { value: "pl", label: "Polish", native: "Polski", iso639_3: "pol", englishName: "Polish" },
];

export const DEFAULT_LANGUAGE: LanguageCode = "auto";

export function getLanguageOption(code: string | null | undefined): LanguageOption {
  const found = LANGUAGE_OPTIONS.find((l) => l.value === code);
  return found ?? LANGUAGE_OPTIONS[0];
}
