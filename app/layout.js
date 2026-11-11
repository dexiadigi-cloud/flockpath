import "./globals.css";
import AppHeader from "../components/AppHeader";

export const metadata = {
  title: "Flockpath - Pastor Review",
  description: "Pastor-approved family discipleship packs, with verified Scripture and a lock gate.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#faf7f0", color: "#222" }}>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
