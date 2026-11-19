import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "../../lib/auth.mjs";
import InputPage from "../../components/InputPage";
import SignOutButton from "../../components/SignOutButton";

export default async function InputRoute({ searchParams }) {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) redirect("/signin");
  // Nov 12, 2026, v55: deep links from the Dashboard.
  // ?topic=<name> fills the topic and runs the Phos search;
  // ?job=<id> reloads that build's status panel.
  const params = await searchParams;
  const initialTopic = typeof params?.topic === "string" ? params.topic : undefined;
  const initialJobId = typeof params?.job === "string" ? params.job : undefined;
  return (
    <>
      <p className="fp-main" style={{ paddingBottom: 0, paddingTop: 16 }}>
        Signed in as {s.name}{s.role === "member" ? " (member)" : `, ${s.church}`} - <SignOutButton />
      </p>
      <InputPage initialTopic={initialTopic} initialJobId={initialJobId} />
    </>
  );
}
