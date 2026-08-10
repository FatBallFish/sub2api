import type { TranslationResource } from "./en";

const ja = {
  common: {
    language: "言語",
    languageSwitcher: {
      triggerLabel: "言語を切り替える",
      options: {
        en: "English",
        zhCN: "简体中文",
        zhTW: "繁體中文",
        ja: "日本語",
      },
    },
  },
  public: {
    title: "ホーム",
  },
  auth: {
    title: "ログイン",
  },
  console: {
    title: "コンソール",
  },
  errors: {
    unknown: "エラーが発生しました。しばらくしてからもう一度お試しください。",
  },
} as const satisfies TranslationResource;

export default ja;
