import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

export function initI18n(language: "ru" | "en" = "ru"): typeof i18n {
  if (i18n.isInitialized) return i18n;
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
  return i18n;
}

export { i18n };
