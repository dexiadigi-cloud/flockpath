// Forgot-password page: honest about what exists. Flockpath
// has no email service, so no reset link can be emailed.
// A pastor who can still sign in changes their password on
// My packs. A pastor who cannot sign in at all recovers with
// the local reset script, on their own computer.
export default function Forgot() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Forgot your password?</h1>
      <p>Flockpath runs on your own computer and has no email service, so no reset link can be emailed to you. There are two ways back in:</p>
      <h2>1. If you can still sign in</h2>
      <p>Sign in, go to My packs, and change your password there under Password. You will need your current password for that change.</p>
      <h2>2. If you cannot sign in at all</h2>
      <p>Run the reset script on the computer that runs Flockpath. Open a terminal in the flockpath app folder and run:</p>
      <p><code>node scripts/reset-password.mjs your-email@example.com your-new-password</code></p>
      <p>The new password must be at least 8 characters. Then sign in with it as usual. Anyone who can run a script in that folder already has full access to this computer&apos;s Flockpath data, so this script opens no door that file access does not already open. It never sends anything anywhere.</p>
      <p><a href="/signin">Back to sign-in</a></p>
    </main>
  );
}
