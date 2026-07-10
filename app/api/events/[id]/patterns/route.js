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

function isMissingColumn(error, column) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42703" || message.includes(column.toLowerCase());
}

// Resolve a stored pattern URL and confirm it points somewhere we're willing
// to fetch server-side, before we fetch it. Pattern URLs are set by staff and
// live in Supabase storage or on this app's own host — restricting to those
// hosts stops a malicious/mistaken URL turning this into a server-side request
// forgery (e.g. hitting a cloud metadata endpoint) that gets embedded into the
// downloadable PDF. Only http/https, and only allow-listed hosts.
function resolveAllowedFetchUrl(rawUrl, reqUrl) {
  const url = new URL(rawUrl, reqUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked pattern URL (unsupported scheme): ${url.protocol}`);
  }
  const allowedHosts = new Set();
  try { allowedHosts.add(new URL(reqUrl).host); } catch {}
  try { allowedHosts.add(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host); } catch {}
  if (!allowedHosts.has(url.host)) {
    throw new Error(`Blocked pattern URL (host not allowed): ${url.host}`);
  }
  return url.toString();
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

function patternGroupLabel(classes) {
  if (classes.length === 1) return `Class ${classes[0].num} - ${classes[0].name}`;
  const refs = classes.map((cls) => cls.num).join(", ");
  return `Classes ${refs} - shared pattern`;
}

function groupPatternClasses(classes) {
  const groups = [];
  const byUrl = new Map();
  classes.forEach((cls) => {
    const patternUrl = String(cls.pattern_url ?? "").trim();
    if (!patternUrl) return;
    if (!byUrl.has(patternUrl)) {
      const group = { patternUrl, classes: [] };
      byUrl.set(patternUrl, group);
      groups.push(group);
    }
    byUrl.get(patternUrl).classes.push(cls);
  });
  return groups;
}

async function loadEvent(db, eventId) {
  const withCustomPdf = await db
    .from("events")
    .select("name, location, starts_on, patterns_pdf_url")
    .eq("id", eventId)
    .single();
  if (!withCustomPdf.error) return withCustomPdf.data;

  if (!isMissingColumn(withCustomPdf.error, "patterns_pdf_url")) {
    return withCustomPdf.data;
  }

  const { data } = await db
    .from("events")
    .select("name, location, starts_on")
    .eq("id", eventId)
    .single();
  return data;
}

async function fetchCustomPdf(patternsPdfUrl, reqUrl) {
  const absoluteUrl = resolveAllowedFetchUrl(patternsPdfUrl, reqUrl);
  const res = await fetch(absoluteUrl);
  if (!res.ok) throw new Error(`Custom PDF download failed (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!isPdf(absoluteUrl, contentType)) {
    throw new Error(`Custom file is not a PDF (${contentType || "unknown file type"})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function appendPattern(pdfDoc, font, bold, label, patternUrl, reqUrl) {
  let absoluteUrl;
  try {
    absoluteUrl = resolveAllowedFetchUrl(patternUrl, reqUrl);
  } catch (err) {
    console.error("Skipping disallowed pattern URL:", err.message);
    return;
  }
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
  const [event, { data: classes }] = await Promise.all([
    loadEvent(db, eventId),
    db.from("classes").select("num, name, day, sort_order, pattern_url").eq("event_id", eventId).order("day").order("sort_order"),
  ]);
  const filename = `${cleanFilename(event?.name)}-patterns.pdf`;
  const customPatternsPdfUrl = String(event?.patterns_pdf_url ?? "").trim();
  let customPdfError = null;

  if (customPatternsPdfUrl) {
    try {
      const bytes = await fetchCustomPdf(customPatternsPdfUrl, req.url);
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      customPdfError = err;
    }
  }

  const patternClasses = (classes ?? [])
    .filter((cls) => cls.pattern_url && (!day || String(cls.day ?? 1) === String(day)));
  const patternGroups = groupPatternClasses(patternClasses);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  addMessagePage(pdfDoc, font, bold, `${event?.name ?? "Event"} - Pattern Book`, [
    [event?.location, event?.starts_on, day ? `Day ${day}` : null].filter(Boolean).join(" - "),
    customPdfError
      ? `The selected rider PDF could not be loaded, so this generated pattern book was used instead. ${customPdfError?.message ?? customPdfError}`
      : null,
    patternGroups.length
      ? `${patternGroups.length} unique pattern file${patternGroups.length === 1 ? "" : "s"} included for ${patternClasses.length} class${patternClasses.length === 1 ? "" : "es"}.`
      : "No class patterns have been uploaded yet.",
  ].filter(Boolean));

  for (const group of patternGroups) {
    await appendPattern(pdfDoc, font, bold, patternGroupLabel(group.classes), group.patternUrl, req.url);
  }

  const bytes = await pdfDoc.save();
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
