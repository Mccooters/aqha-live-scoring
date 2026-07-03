// Web app manifest — makes the site installable to the iPhone/Android Home
// Screen as a standalone app (required for iOS web push notifications).
// Next.js serves this at /manifest.webmanifest and links it automatically.
export default function manifest() {
  return {
    name: "HCQHA Live Scoring",
    short_name: "HCQHA Live",
    description:
      "Live class tracking and scoring for Hunter Coast Quarter Horse Association events",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF8F2",
    theme_color: "#3A2A1C",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
