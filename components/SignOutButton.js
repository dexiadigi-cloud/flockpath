"use client";

import { useAppLanguage } from "./AppLanguage";

export default function SignOutButton() {
  const { t } = useAppLanguage();
  async function out() {
    await fetch("/api/signin", { method: "DELETE" });
    window.location.href = "/signin";
  }
  return <button onClick={out}>{t("nav.signOut")}</button>;
}
