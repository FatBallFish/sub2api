import React from "react";
import { useTranslation } from "react-i18next";
import PublicMarkdownPage from "./PublicMarkdownPage";

export default function Team() {
  const { t } = useTranslation("public");
  return (
    <PublicMarkdownPage slug="team" fallbackTitle={t("team.heading")}>
      <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-12">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("team.heading")}</h1>
        <p className="text-zinc-500 leading-relaxed text-lg">
          {t("team.description")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-8 bg-zinc-50 rounded-2xl">
            <h3 className="font-bold text-xl">{t("team.operatorTitle")}</h3>
            <p className="text-sm text-zinc-500 mt-2">{t("team.operatorDescription")}</p>
          </div>
          <div className="p-8 bg-zinc-50 rounded-2xl">
            <h3 className="font-bold text-xl">{t("team.controlPlaneTitle")}</h3>
            <p className="text-sm text-zinc-500 mt-2">{t("team.controlPlaneDescription")}</p>
          </div>
        </div>
      </div>
    </PublicMarkdownPage>
  );
}
