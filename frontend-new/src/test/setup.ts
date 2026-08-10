import "@testing-library/jest-dom/vitest";
import { setI18n } from "react-i18next";
import { beforeEach } from "vitest";
import i18n, { initializeI18n, LOCALE_STORAGE_KEY } from "../i18n";

beforeEach(async () => {
  await initializeI18n();
  await i18n.changeLanguage("en");
  setI18n(i18n);
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});
