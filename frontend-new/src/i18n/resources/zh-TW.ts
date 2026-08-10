import type { TranslationResource } from "./en";

const zhTW = {
  common: {
    language: "語言",
    languageSwitcher: {
      triggerLabel: "切換語言",
      options: {
        en: "English",
        zhCN: "简体中文",
        zhTW: "繁體中文",
        ja: "日本語",
      },
    },
  },
  public: {
    title: "首頁",
  },
  auth: {
    title: "登入",
  },
  console: {
    title: "控制台",
  },
  errors: {
    unknown: "發生錯誤，請稍後再試。",
  },
} as const satisfies TranslationResource;

export default zhTW;
