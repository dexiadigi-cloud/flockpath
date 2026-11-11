// Shared app header: Flockpath logo where a pastor expects it,
// top left on every page, with a short nav. No session logic
// here, so it also renders on the sign-in and About pages;
// protected pages still redirect to sign-in on their own.
export default function AppHeader() {
  return (
    <header className="fp-header">
      <a href="/" className="fp-brand">
        <img src="/flockpath-logo.png" alt="Flockpath logo" width={44} height={38} />
        <span>Flockpath</span>
      </a>
      <nav className="fp-nav">
        <a href="/input">Start a pack</a>
        <a href="/review">Review</a>
        <a href="/packs">My packs</a>
        <a href="/credits">Credits</a>
        <a href="/about">About</a>
      </nav>
    </header>
  );
}
