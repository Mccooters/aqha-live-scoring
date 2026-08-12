"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import ReadOnlyBanner from "../../components/ReadOnlyBanner";

// Staff access: add/remove staff logins and flip them between full access and
// read-only committee view — no Supabase dashboard needed. The API route does
// the real work with the admin key; writes are refused for read-only accounts.

const fmtDate = (s) => (s ? new Date(s).toLocaleString("en-AU", { dateStyle: "medium" }) : "never");

export default function StaffAccessPage() {
  const [session, setSession] = useState(null);
  const [users, setUsers] = useState([]);
  const [viewersReady, setViewersReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAccess, setNewAccess] = useState("viewer");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const authed = useCallback(async (method, body) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch("/api/staff/users", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
    return json;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await authed("GET");
      setUsers(data.users ?? []);
      setViewersReady(Boolean(data.viewers_ready));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => { if (session) load(); }, [session, load]);

  const addUser = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await authed("POST", { email: newEmail, password: newPassword, access: newAccess });
      setNotice(res.warning ?? `Login created for ${newEmail.trim()} — give them the email and temporary password to sign in on the Staff page.`);
      setNewEmail(""); setNewPassword("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setAccess = async (u, access) => {
    if (access === "viewer" && !window.confirm(`Make ${u.email} read-only?\n\nThey'll still see the whole back end, but every change from their login will be refused.`)) return;
    if (access === "full" && !window.confirm(`Give ${u.email} FULL staff access?\n\nThey'll be able to change anything — scores, entries, memberships, refunds.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await authed("PATCH", { user_id: u.id, access });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Remove ${u.email}'s staff login entirely?\n\nThey won't be able to sign in to the staff side at all. This can't be undone (though a new login can always be created).`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await authed("DELETE", { user_id: u.id });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <main className="wrap" style={{ maxWidth: 440 }}>
        <h1 className="display" style={{ fontWeight: 700, fontSize: 22 }}>Staff access</h1>
        <p style={{ color: "var(--quiet)", fontSize: 14 }}>
          Please <Link href="/coordinator" style={{ color: "var(--brass)" }}>sign in on the Staff page</Link> first.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Staff</div>
          <h1 className="display" style={{ fontWeight: 700, fontSize: "clamp(20px,4vw,26px)", margin: "2px 0", color: "#F2EADB" }}>Staff access</h1>
          <div style={{ fontSize: 13, color: "#CBBFA9" }}>
            Who can sign in to the back end — full access runs the show; read-only sees everything but changes nothing.
          </div>
        </div>
      </header>
      <main className="wrap" style={{ maxWidth: 860 }}>
        <ReadOnlyBanner />
        <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 4 }}>
          <Link href="/coordinator" style={{ color: "var(--brass)" }}>← Back to dashboard</Link>
        </p>

        {!viewersReady && !loading && (
          <div className="card" style={{ padding: "10px 14px", border: "1px solid #E0B15A", background: "#FFF7D6" }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--leather)", fontWeight: 700 }}>
              Read-only accounts need a one-time database update — run &quot;schema-v48-committee-viewers.sql&quot; in the Supabase SQL Editor.
              Until then every login has full access.
            </p>
          </div>
        )}
        {error && <p style={{ color: "var(--clay)", fontWeight: 700, fontSize: 13.5 }}>{error}</p>}
        {notice && <p style={{ color: "var(--green)", fontWeight: 700, fontSize: 13.5 }}>{notice}</p>}

        <section className="card">
          <div className="card-head">
            <div className="display" style={{ fontWeight: 700, fontSize: 16 }}>Staff logins</div>
            {loading && <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>Loading…</span>}
          </div>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Access</th>
                <th className="hide-mobile">Last sign-in</th>
                <th style={{ width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>
                    {u.email}
                    {u.is_you && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--brass)", fontWeight: 800 }}>YOU</span>}
                  </td>
                  <td>
                    {u.viewer ? (
                      <span style={{ background: "#F3EEE4", border: "1px solid #D8D0C3", color: "#6E6254", borderRadius: 20, padding: "2px 10px", fontSize: 11.5, fontWeight: 800 }}>
                        👁 Read-only
                      </span>
                    ) : (
                      <span style={{ background: "var(--green)", color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 11.5, fontWeight: 800 }}>
                        Full access
                      </span>
                    )}
                  </td>
                  <td className="hide-mobile" style={{ color: "var(--quiet)", fontSize: 12.5 }}>{fmtDate(u.last_sign_in_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!u.is_you && (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {u.viewer ? (
                          <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => setAccess(u, "full")}>
                            Give full access
                          </button>
                        ) : viewersReady ? (
                          <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => setAccess(u, "viewer")}>
                            Make read-only
                          </button>
                        ) : null}
                        <button className="btn-ghost danger" style={{ fontSize: 12 }} disabled={busy} onClick={() => removeUser(u)}>
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" style={{ padding: "14px 16px" }}>
          <div className="display" style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Add a staff login</div>
          <p style={{ fontSize: 12.5, color: "var(--quiet)", margin: "0 0 10px" }}>
            Create the login, then give the person their email and temporary password — they sign in on the Staff page
            (and can change the password from there any time). Choose <strong>Read-only</strong> for committee members
            who should see everything but change nothing.
          </p>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr", maxWidth: 460 }}>
            <input className="field" type="email" style={{ fontSize: 15 }} placeholder="Email address"
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="field" type="text" style={{ fontSize: 15 }} placeholder="Temporary password (8+ characters)"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <select className="field" style={{ fontSize: 15 }} value={newAccess} onChange={(e) => setNewAccess(e.target.value)}>
              <option value="viewer">👁 Read-only — committee view</option>
              <option value="full">Full access — can run shows and change anything</option>
            </select>
            <button className="btn" style={{ background: "var(--leather)" }} disabled={busy || !newEmail.trim() || newPassword.length < 8}
              onClick={addUser}>
              {busy ? "Working…" : "Create login"}
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
