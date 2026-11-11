import { redirect } from "next/navigation";

// Nov 5, 2026, round-2: the app starts on Start a pack.
// A returning pastor used to land on Review again, which
// reads like the app forgot what it is for. Review lives
// at /review now, and the nav still reaches it. The input
// page itself redirects unsigned visitors to sign-in, so
// this redirect needs no session check of its own.
export default function Home() {
  redirect("/input");
}
