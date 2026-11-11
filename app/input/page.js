import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "../../lib/auth.mjs";
import InputPage from "../../components/InputPage";
import SignOutButton from "../../components/SignOutButton";

export default async function InputRoute() {
  const store = await cookies();
  const s = verifySession(store.get("flockpath_session")?.value);
  if (!s) redirect("/signin");
  return (
    <>
      <p style={{ maxWidth: 720, margin: "0 auto", padding: "16px 24px 0", fontFamily: "system-ui, sans-serif" }}>
        Signed in as {s.name}, {s.church} - <SignOutButton />
      </p>
      <InputPage />
    </>
  );
}
