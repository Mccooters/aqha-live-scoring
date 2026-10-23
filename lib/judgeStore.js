// On-device storage for the judge page (schema-v63): the show snapshot, the
// judge's cards and the send queue live in the browser's IndexedDB so every
// tap is kept even with no reception, a closed tab or a flat battery. Tiny
// key/value wrapper — no dependency. Falls back to localStorage where
// IndexedDB is unavailable (private browsing on some phones).

const DB_NAME = "hcqha-judge";
const STORE = "kv";

let dbPromise = null;
function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const lsKey = (key) => `hcqha-judge:${key}`;

export async function storeGet(key) {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  try { const raw = localStorage.getItem(lsKey(key)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function storeSet(key, value) {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    });
  }
  try { localStorage.setItem(lsKey(key), JSON.stringify(value)); return true; } catch { return false; }
}

// A stable id for this phone/tablet, so the dashboard can tell two devices
// signed in as the same judge apart.
export function deviceId() {
  try {
    let id = localStorage.getItem("hcqha-judge-device");
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("hcqha-judge-device", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Precache the page shell so the judge page opens with no signal: the
// document itself plus every script/style it loaded. Next.js chunk names are
// content-hashed, so keeping them is always safe. Pattern files are added
// too (best effort) so "View pattern" works offline.
export async function precacheShell(extraUrls = []) {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open("judge-shell-v1");
    const urls = new Set([window.location.pathname]);
    performance.getEntriesByType("resource").forEach((r) => {
      if (/\/_next\/static\//.test(r.name) || /fonts\.(googleapis|gstatic)\.com/.test(r.name)) urls.add(r.name);
    });
    document.querySelectorAll("script[src], link[rel=stylesheet][href]").forEach((el) => {
      const u = el.src || el.href;
      if (u) urls.add(u);
    });
    for (const u of urls) {
      try { await cache.add(new Request(u, { mode: u.startsWith(window.location.origin) || u.startsWith("/") ? "same-origin" : "no-cors" })); } catch {}
    }
    for (const u of extraUrls) {
      if (!u) continue;
      try {
        const hit = await cache.match(u);
        if (!hit) await cache.add(new Request(u, { mode: "no-cors" }));
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}
