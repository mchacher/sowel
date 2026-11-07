import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "sowel_language",
    },
  });

// Spec 196 — `<html lang>` follows the UI language, so the browser hyphenates,
// reads aloud and offers translation in the right language. `fr-FR` → `fr`.
function syncDocumentLang(language: string | undefined): void {
  if (typeof document === "undefined" || !document.documentElement || !language) return;
  document.documentElement.lang = language.slice(0, 2);
}
i18n.on("languageChanged", syncDocumentLang);
syncDocumentLang(i18n.language);

export default i18n;
