const en = {
  common: {
    language: "Language",
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
