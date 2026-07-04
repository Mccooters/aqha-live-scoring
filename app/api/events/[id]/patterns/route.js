import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { adminClient } from "../../../_lib/registrations";

export const dynamic = "force-dynamic";

const A4 = [595.28, 841.89];

function cleanFilename(value) {
  return String(value ?? "patterns").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "patterns";
}

function isPdf(url, contentType) {
  return contentType?.includes("pdf") || new URL(url).pathname.toLowerCase().endsWith(".pdf");
}

function isPng(url, contentType) {
  return contentType?.includes("png") || new URL(url).pathname.toLowerCase().endsWith(".png");
}

function isJpeg(url, contentType) {
  const path = new URL(url).pathname.toLowerCase();
  return contentType?.includes("jpeg") || contentType?.includes("jpg") || path.endsWith(".jpg") || path.endsWith(".jpeg");
}

function drawWrappedText(page, text, { x, y, size = 11, font, color = rgb(0, 0, 0), maxWidth = 500, lineHeight = size + 4 }) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  let line = "";
  let cursorY = y;
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      page.drawText(line, { x, y: cursorY, size, font, color });
      line = word;
      cursorY -= lineHeight;
    } else {
      line = next;
    }
  });
  if (line) page.drawText(line, { x, y: cursorY, size, font, color });
  return cursorY - lineHeight;
}

function addMessagePage(pdfDoc, font, bold, title, lines = []) {
  const page = pdfDoc.addPage(A4);
  page.drawText(title, { x: 54, y: 778, size: 18, font: bold, color: rgb(0.12, 0.08, 0.04) });
  let y = 742;
  lines.forEach((line) => {
    y = drawWrappedText(page, line, { x: 54, y, size: 11, font, maxWidth: 488 });
  });
}

async function appendPattern(pdfDoc, font, bold, cls, patternUrl, reqUrl) {
  const absoluteUrl = new URL(patternUrl, reqUrl).toString();
  const label = `Class ${cls.num} - ${cls.name}`;
  try {
    const res = await fetch(absoluteUrl);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const contentType = res.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (isPdf(absoluteUrl, contentType)) {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copied = await pdfDoc.copyPages(source, source.getPageIndices());
      copied.forEach((page, idx) => {
        pdfDoc.addPage(page);
        if (idx === 0) {
          const { width, height } = page.getSize();
          page.drawRectangle({ x: 0, y: height - 22, width, height: 22, color: rgb(1, 1, 1) });
          page.drawText(label, { x: 24, y: height - 16, size: 9, font: bold, color: rgb(0.12, 0.08, 0.04) });
        }
      });
      return;
    }

    let image;
    if (isPng(absoluteUrl, contentType)) image = await pdfDoc.embedPng(bytes);
    if (isJpeg(absoluteUrl, contentType)) image = await pdfDoc.embedJpg(bytes);
    if (!image) throw new Error(`Unsupported pattern file type: ${contentType || "unknown"}`);

    const page = pdfDoc.addPage(A4);
    page.drawText(label, { x: 42, y: 796, size: 15, font: bold, color: rgb(0.12, 0.08, 0.04) });
    const maxWidth = A4[0] - 84;
    const maxHeight = A4[1] - 112;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (A4[0] - width) / 2, y: 42, width, height });
  } catch (err) {
    addMessagePage(pdfDoc, font, bold, label, [
      "This pattern could not be added to the combined PDF.",
      err?.message ?? String(err),
      absoluteUrl,
    ]);
  }
}

export async function GET(req, { params }) {
  const db = adminClient();
  const eventId = params.id;
  const day = new URL(req.url).searchParams.get("day");
  const [{ data: event }, { data: classes }] = await Promise.all([
    db.from("events").select("name, location, starts_on").eq("id", eventId).single(),
    db.from("classes").select("num, name, day, sort_order, pattern_url").eq("event_id", eventId).order("day").order("sort_order"),
  ]);

  const patternClasses = (classes ?? [])
    .filter((cls) => cls.pattern_url && (!day || String(cls.day ?? 1) === String(day)));

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  addMessagePage(pdfDoc, font, bold, `${event?.name ?? "Event"} - Pattern Book`, [
    [event?.location, event?.starts_on, day ? `Day ${day}` : null].filter(Boolean).join(" - "),
    patternClasses.length ? `${patternClasses.length} pattern${patternClasses.length === 1 ? "" : "s"} included.` : "No class patterns have been uploaded yet.",
  ]);

  for (const cls of patternClasses) {
    await appendPattern(pdfDoc, font, bold, cls, cls.pattern_url, req.url);
  }

  const bytes = await pdfDoc.save();
  const filename = `${cleanFilename(event?.name)}-patterns.pdf`;
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
