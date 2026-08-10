import "i18next";
import type en from "./resources/en";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    returnNull: false;
    resources: typeof en;
  }
}
