import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

// Member password hashing. Uses Node's built-in scrypt (deliberately slow,
// per-password salt) — no external dependency. The parameters are stored
// with each hash, so they can be raised later without breaking passwords
// that were set under the old ones.

const scrypt = promisify(scryptCb);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P });
  return [
    "scrypt", N, R, P,
    salt.toString("base64"),
    Buffer.from(hash).toString("base64"),
  ].join(":");
}

// A valid-format hash used only to spend the same scrypt time on the
// "no account / no password set" path as on a real wrong-password guess, so
// response timing can't reveal which emails have a password. It never matches
// any real password (it's the hash of a throwaway value under a random salt).
export const DUMMY_PASSWORD_HASH =
  "scrypt:16384:8:1:ff0Y72m0Ixbhmy0QFv0W8A==:pi/A/wDrZfIhztVqLsNoUaCYOw1TywYdBaEt5ez8rN7F6WTOlWv5SAl8+/V12gLWKYhdexuL09UDvbdjMAn8nA==";

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored ?? "").split(":");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (!salt.length || !expected.length) return false;
    const actual = await scrypt(String(password), salt, expected.length, {
      N: parseInt(n, 10), r: parseInt(r, 10), p: parseInt(p, 10),
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
