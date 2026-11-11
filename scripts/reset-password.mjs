// Nov 4, 2026, local password recovery (Mac pastor-role test
// item 3, second half). Flockpath has no email service, so
// there is no email reset link. For a local app, this script
// is the honest recovery: run it on the pastor's own
// computer, and it sets a new password for the given email
// and clears any sign-in lockout.
//
// Security note, stated plainly: anyone who can run a script
// in this folder already has full access to this computer's
// Flockpath data (accounts, packs, drafts). This script opens
// no door that file access does not already open. It never
// prints the password, and it never sends anything anywhere.
//
// Usage, from anywhere (the script finds the app folder
// itself, from its own location):
//   node scripts/reset-password.mjs pastor@church.example new-password-here
// The new password must be at least 8 characters, the demo
// rule. Then sign in with it as usual.
import path from "node:path";
import { fileURLToPath } from "node:url";

// The app root is this script's parent folder, and auth reads
// data/ from the working dir. Change dir BEFORE importing
// auth, or its data path binds to the caller's folder.
// (Static imports run first, so auth loads dynamically here.)
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const { resetPassword } = await import("../lib/auth.mjs");

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-password.mjs <email> <new-password>");
  process.exit(2);
}
try {
  const pastor = resetPassword(email, newPassword);
  console.log(`Password reset for ${pastor.email}. Sign in with the new password.`);
} catch (e) {
  console.error(`Could not reset: ${e.message}`);
  process.exit(1);
}
