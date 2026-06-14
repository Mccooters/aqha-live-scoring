import "./globals.css";
import BottomNav from "./components/BottomNav";

export const metadata = {
  title: "AQHA Live Scoring",
  description: "Live class tracking and scoring for AQHA events",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Archivo:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <BottomNav />
        {children}
      </body>
    </html>
  );
}
