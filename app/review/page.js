import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "../../lib/auth.mjs";
import ReviewPage from "../../components/ReviewPage";
import SignOutButton from "../../components/SignOutButton";

// Nov 5, 2026, round-2: review moved here from the root.
// The root now lands on Start a pack, so a returning
// pastor starts where a pack starts instead of landing
// on Review again. The page itself is unchanged: same
// session check, same draft loading, same review loop.
export default async function Review({ searchParams }) {
  const store = await cookies();
  const session = verifySession(store.get("flockpath_session")?.value);
  if (!session) redirect("/signin");
  const params = await searchParams;
  const draftId = typeof params?.draft === "string" ? params.draft : undefined;
  return (
    <div>
      <p style={{ maxWidth: 820, margin: "16px auto 0", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
        Signed in as {session.name}, {session.church} | <SignOutButton />
      </p>
      <ReviewPage session={session} draftId={draftId} />
    </div>
  );
}
