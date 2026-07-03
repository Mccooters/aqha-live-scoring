// One-off generator for the app/home-screen icons.
// Renders a branded HCQHA icon with next/og (already a dependency) so we don't
// pull in any image tooling. Re-run with: node scripts/gen-icons.mjs
import { createRequire } from "node:module";
import React from "react";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// next/og's subpath isn't exposed to plain Node scripts via the package
// exports map, so reach the compiled module directly.
const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/dist/server/og/image-response");

const fontData = await readFile("/System/Library/Fonts/Supplemental/Arial Bold.ttf");

const LEATHER = "#3A2A1C";
const BRASS = "#C9A24B";

function iconElement(size) {
  const pad = Math.round(size * 0.09);
  const inner = size - pad * 2;
  const border = Math.max(2, Math.round(size * 0.028));
  const radius = Math.round(size * 0.17);
  return React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Full-bleed background — iOS masks the corners itself.
        background: LEATHER,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `${border}px solid ${BRASS}`,
          borderRadius: radius,
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Arial",
            fontWeight: 700,
            fontSize: Math.round(size * 0.42),
            color: BRASS,
            letterSpacing: `-${Math.round(size * 0.01)}px`,
          },
        },
        "HC"
      )
    )
  );
}

async function gen(size, file) {
  const resp = new ImageResponse(iconElement(size), {
    width: size,
    height: size,
    fonts: [{ name: "Arial", data: fontData, weight: 700, style: "normal" }],
  });
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(file, buf);
  console.log("wrote", file, buf.length, "bytes");
}

await mkdir("public", { recursive: true });
await gen(512, "public/icon-512.png");
await gen(192, "public/icon-192.png");
await gen(180, "public/apple-touch-icon.png");
await gen(48, "public/favicon-48.png");
console.log("done");
