"use client";

export default function SignOutButton() {
  async function out() {
    await fetch("/api/signin", { method: "DELETE" });
    window.location.href = "/signin";
  }
  return <button onClick={out}>Sign out</button>;
}
