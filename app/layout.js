import "./globals.css";
import AppHeader from "../components/AppHeader";

export const metadata = {
  title: "Flockpath - Pastor Review",
  description: "Pastor-approved family discipleship packs, with verified Scripture and a lock gate.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="fp-shell">
          <AppHeader />
          <div className="fp-content">{children}</div>
        </div>
      </body>
    </html>
  );
}
