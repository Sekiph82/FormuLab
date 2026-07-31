import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LOCALE, detectInitialLocale } from "./config";

// Statically bundled: the whole UI string set across 8 languages is a few KB,
// so it ships in the main chunk. Revisit lazy-loading only if this grows large.
import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enSettings from "./locales/en/settings.json";
import enRuns from "./locales/en/runs.json";
import enSession from "./locales/en/session.json";
import enInspector from "./locales/en/inspector.json";
import enErrors from "./locales/en/errors.json";
import enPages from "./locales/en/pages.json";
import enHelp from "./locales/en/help.json";

import zhCommon from "./locales/zh-Hans/common.json";
import zhNav from "./locales/zh-Hans/nav.json";
import zhSettings from "./locales/zh-Hans/settings.json";
import zhRuns from "./locales/zh-Hans/runs.json";
import zhSession from "./locales/zh-Hans/session.json";
import zhInspector from "./locales/zh-Hans/inspector.json";
import zhErrors from "./locales/zh-Hans/errors.json";
import zhPages from "./locales/zh-Hans/pages.json";
import zhHelp from "./locales/zh-Hans/help.json";

import jaCommon from "./locales/ja/common.json";
import jaNav from "./locales/ja/nav.json";
import jaSettings from "./locales/ja/settings.json";
import jaRuns from "./locales/ja/runs.json";
import jaSession from "./locales/ja/session.json";
import jaInspector from "./locales/ja/inspector.json";
import jaErrors from "./locales/ja/errors.json";
import jaPages from "./locales/ja/pages.json";
import jaHelp from "./locales/ja/help.json";

import esCommon from "./locales/es/common.json";
import esNav from "./locales/es/nav.json";
import esSettings from "./locales/es/settings.json";
import esRuns from "./locales/es/runs.json";
import esSession from "./locales/es/session.json";
import esInspector from "./locales/es/inspector.json";
import esErrors from "./locales/es/errors.json";
import esPages from "./locales/es/pages.json";
import esHelp from "./locales/es/help.json";

import deCommon from "./locales/de/common.json";
import deNav from "./locales/de/nav.json";
import deSettings from "./locales/de/settings.json";
import deRuns from "./locales/de/runs.json";
import deSession from "./locales/de/session.json";
import deInspector from "./locales/de/inspector.json";
import deErrors from "./locales/de/errors.json";
import dePages from "./locales/de/pages.json";
import deHelp from "./locales/de/help.json";

import frCommon from "./locales/fr/common.json";
import frNav from "./locales/fr/nav.json";
import frSettings from "./locales/fr/settings.json";
import frRuns from "./locales/fr/runs.json";
import frSession from "./locales/fr/session.json";
import frInspector from "./locales/fr/inspector.json";
import frErrors from "./locales/fr/errors.json";
import frPages from "./locales/fr/pages.json";
import frHelp from "./locales/fr/help.json";

import koCommon from "./locales/ko/common.json";
import koNav from "./locales/ko/nav.json";
import koSettings from "./locales/ko/settings.json";
import koRuns from "./locales/ko/runs.json";
import koSession from "./locales/ko/session.json";
import koInspector from "./locales/ko/inspector.json";
import koErrors from "./locales/ko/errors.json";
import koPages from "./locales/ko/pages.json";
import koHelp from "./locales/ko/help.json";

import trCommon from "./locales/tr/common.json";
import trNav from "./locales/tr/nav.json";
import trSettings from "./locales/tr/settings.json";
import trRuns from "./locales/tr/runs.json";
import trSession from "./locales/tr/session.json";
import trInspector from "./locales/tr/inspector.json";
import trErrors from "./locales/tr/errors.json";
import trPages from "./locales/tr/pages.json";
import trHelp from "./locales/tr/help.json";

export const NAMESPACES = [
  "common", "nav", "settings", "runs", "session", "inspector", "errors", "pages", "help",
] as const;

const resources = {
  en: { common: enCommon, nav: enNav, settings: enSettings, runs: enRuns, session: enSession, inspector: enInspector, errors: enErrors, pages: enPages, help: enHelp },
  "zh-Hans": { common: zhCommon, nav: zhNav, settings: zhSettings, runs: zhRuns, session: zhSession, inspector: zhInspector, errors: zhErrors, pages: zhPages, help: zhHelp },
  ja: { common: jaCommon, nav: jaNav, settings: jaSettings, runs: jaRuns, session: jaSession, inspector: jaInspector, errors: jaErrors, pages: jaPages, help: jaHelp },
  es: { common: esCommon, nav: esNav, settings: esSettings, runs: esRuns, session: esSession, inspector: esInspector, errors: esErrors, pages: esPages, help: esHelp },
  de: { common: deCommon, nav: deNav, settings: deSettings, runs: deRuns, session: deSession, inspector: deInspector, errors: deErrors, pages: dePages, help: deHelp },
  fr: { common: frCommon, nav: frNav, settings: frSettings, runs: frRuns, session: frSession, inspector: frInspector, errors: frErrors, pages: frPages, help: frHelp },
  ko: { common: koCommon, nav: koNav, settings: koSettings, runs: koRuns, session: koSession, inspector: koInspector, errors: koErrors, pages: koPages, help: koHelp },
  tr: { common: trCommon, nav: trNav, settings: trSettings, runs: trRuns, session: trSession, inspector: trInspector, errors: trErrors, pages: trPages, help: trHelp },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  ns: NAMESPACES,
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
});

export default i18n;
