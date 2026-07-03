import "./globals.css";
import BottomNav from "./components/BottomNav";

export const metadata = {
  title: "HCQHA Live Scoring",
  description: "Live class tracking and scoring for Hunter Coast Quarter Horse Association events",
  icons: {
    icon: [
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Lets iPhone/Android treat the Home Screen shortcut as a full-screen app,
  // which is what makes iOS web push notifications possible.
  appleWebApp: {
    capable: true,
    title: "HCQHA Live",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  themeColor: "#3A2A1C",
  width: "device-width",
  initialScale: 1,
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
