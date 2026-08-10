import type { TranslationResource } from "./en";

const zhCN = {
  common: {
    language: "语言",
    languageSwitcher: {
      triggerLabel: "切换语言",
      options: {
        en: "English",
        zhCN: "简体中文",
        zhTW: "繁體中文",
        ja: "日本語",
      },
    },
  },
  public: {
    title: "首页",
  },
  auth: {
    title: "登录",
  },
  console: {
    title: "控制台",
  },
  errors: {
    unknown: "出现错误，请稍后重试。",
  },
} as const satisfies TranslationResource;

export default zhCN;
