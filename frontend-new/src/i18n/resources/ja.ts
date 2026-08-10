import type { TranslationResource } from "./en";

const ja = {
  common: {
    language: "言語",
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
