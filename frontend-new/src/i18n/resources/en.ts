const en = {
  common: {
    language: "Language",
    languageSwitcher: {
      triggerLabel: "Change language",
      options: {
        en: "English",
        zhCN: "简体中文",
        zhTW: "繁體中文",
        ja: "日本語",
      },
    },
  },
  public: {
    title: "Home",
  },
  auth: {
    title: "Sign in",
  },
  console: {
    title: "Console",
  },
  errors: {
    unknown: "Something went wrong.",
  },
} as const;

type StringResourceShape<T> = {
  [Key in keyof T]: T[Key] extends string
    ? string
    : T[Key] extends Record<string, unknown>
      ? StringResourceShape<T[Key]>
      : never;
};

export type TranslationResource = StringResourceShape<typeof en>;

export default en;
