import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import i18n, { initializeI18n, LOCALE_STORAGE_KEY } from "../i18n";

beforeEach(async () => {
  await initializeI18n();
  await i18n.changeLanguage("en");
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});
