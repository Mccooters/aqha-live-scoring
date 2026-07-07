import { cookies } from "next/headers";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

// Member sign-in (the /account portal). Members are deliberately NOT Supabase
// auth users — every RLS rule in this app treats any authenticated user as
// staff with full write access. Instead: a 6-digit emailed code proves they
// own the email on their membership application, then an app-managed session
// (member_sessions row + httpOnly cookie) keeps them signed in. Only the
// code/token hashes are stored; the raw token lives only in the cookie.

export const SESSION_COOKIE = "member_session";
export const CODE_TTL_MS = 10 * 60 * 1000;            // codes last 10 minutes
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // sessions last 90 days
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_PASSWORD_ATTEMPTS = 10;              // then locked for a while
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;       // (emailed code still works)

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function generateCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function codesMatch(code, storedHash) {
  const a = Buffer.from(sha256Hex(code), "hex");
  const b = Buffer.from(String(storedHash ?? ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// Both sign-in methods (emailed code, password) end here: a session row
// keyed by the hash of a fresh random token, which goes into the cookie.
export async function createMemberSession(db, accountId) {
  const token = generateSessionToken();
  const { error } = await db.from("member_sessions").insert({
    account_id: accountId,
    token_hash: sha256Hex(token),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);

  // Tidy up this account's already-expired sessions — cheap housekeeping so
  // the table never needs a scheduled job.
  await db
    .from("member_sessions")
    .delete()
    .eq("account_id", accountId)
    .lt("expires_at", new Date().toISOString());

  return token;
}

// Cookie -> session row -> account. Returns { id, email, ... } or null.
// (password_hash rides along for server-side use — e.g. the portal's
// "do you have a password" flag — and must never be sent to the browser.)
export async function getMemberAccount(db) {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const { data: session } = await db
    .from("member_sessions")
    .select("id, expires_at, account:member_accounts(id, email, created_at, password_hash)")
    .eq("token_hash", sha256Hex(raw))
    .maybeSingle();
  if (!session?.account) return null;

  if (new Date(session.expires_at) <= new Date()) {
    await db.from("member_sessions").delete().eq("id", session.id);
    return null;
  }
  return session.account;
}

// ilike gives case-insensitive matching; escape its wildcards so an email
// containing % or _ can only ever match itself (same idiom as memberships.js).
export function escapeIlike(value) {
  return String(value ?? "").replace(/([\\%_])/g, "\\$1");
}

// The single ownership rule for the whole portal: a club_members row belongs
// to the account whose email matches the row's email.
export async function assertOwnsMember(db, account, memberId) {
  if (!memberId) return null;
  const { data: member } = await db
    .from("club_members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  if (!member) return null;
  if (normalizeEmail(member.email) !== account.email) return null;
  return member;
}

// Fetch a child row (a person or horse on a membership) together with its
// parent application, verifying the application belongs to the signed-in
// account. Null on any miss, so callers answer 404 either way — IDs can't
// be probed.
export async function ownedChildRow(db, account, table, id) {
  if (!id) return null;
  const { data: row } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const member = await assertOwnsMember(db, account, row.member_id);
  if (!member) return null;
  return { row, member };
}

export function notSignedIn() {
  return { error: "Not signed in" };
}
