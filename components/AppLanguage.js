// Nov 20, 2026, v62 (item 1): the app-language context.
// Client components read the current app language and the t()
// function from here. The server-rendered shell (layout.js)
// passes the stored language in as initialLanguage, so the
// first paint already uses the right language; the /api/me
// refresh below keeps it current across client-side
// navigation, where the layout does not re-render. The
// strings themselves live in lib/appStrings.mjs, with
// English as the fallback for any untranslated key.
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { t, DEFAULT_APP_LANGUAGE } from "../lib/appStrings.mjs";

const AppLanguageContext = createContext({
  language: DEFAULT_APP_LANGUAGE,
  setLanguage: () => {},
  t: (key) => t(DEFAULT_APP_LANGUAGE, key),
});

export function AppLanguageProvider({ initialLanguage, children }) {
  const [language, setLanguage] = useState(initialLanguage || DEFAULT_APP_LANGUAGE);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && (data.appLanguage === "en" || data.appLanguage === "es")) {
          setLanguage(data.appLanguage);
        }
      })
      .catch(() => {});
  }, []);
  return (
    <AppLanguageContext.Provider value={{ language, setLanguage, t: (key) => t(language, key) }}>
      {children}
    </AppLanguageContext.Provider>
  );
}

export function useAppLanguage() {
  return useContext(AppLanguageContext);
}
