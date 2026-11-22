import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, getPastor } from "../../lib/auth.mjs";
import { t } from "../../lib/appStrings.mjs";
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
  // Nov 21, 2026, v63 round 2: the signed-in line renders in
  // the stored app language, like the packs page already did.
  const appLanguage = getPastor(session.email)?.appLanguage || "en";
  return (
    <div>
      <p className="fp-main" style={{ paddingBottom: 0, paddingTop: 16 }}>
        {t(appLanguage, "packs.signedInAs")} {session.name}{session.role === "member" ? t(appLanguage, "packs.memberSuffix") : `, ${session.church}`} | <SignOutButton />
      </p>
      <ReviewPage session={session} draftId={draftId} />
    </div>
  );
}
