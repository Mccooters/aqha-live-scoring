"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

// Second menu row for signed-in staff (owner's request, Oct 2026): the
// club-wide tools that aren't about one show or clinic — memberships, money,
// raffles, staff logins — used to sit only under "People & money" on the
// event dashboard, so finding them meant going through an event first.
// Event-specific tools (registrations, program, gate, judges…) stay on the
// dashboard. Rendered under BottomNav on every page; nothing shows for
// spectators or members (no staff session).
const STAFF_NAV = [
  { href: "/coordinator",             label: "Events",      match: (p) => p === "/coordinator" || p.startsWith("/coordinator/registrations") || p.startsWith("/coordinator/program") || p.startsWith("/coordinator/extras") },
  { href: "/coordinator/memberships", label: "Memberships" },
  { href: "/coordinator/revenue",     label: "Revenue" },
  { href: "/coordinator/raffles",     label: "Raffles" },
  { href: "/coordinator/fees",        label: "Website fees" },
  { href: "/coordinator/numbers",     label: "New numbers" },
  { href: "/coordinator/staff",       label: "Staff access" },
  { href: "/coordinator/health",      label: "Health" },
];

export default function StaffNav() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(Boolean(s)));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!signedIn) return null;
  // Judge / gate links are handed to people who aren't staff; a staff login on
  // the same device would otherwise get the row on top of those pages too.
  if (/^\/event\/[^/]+\/(gate|judge)/.test(path ?? "")) return null;

  return (
    <nav className="staff-nav" aria-label="Staff">
      {STAFF_NAV.map(({ href, label, match }) => {
        const active = match ? match(path ?? "") : (path ?? "").startsWith(href);
        return (
          <Link key={href} href={href} className={active ? "active" : ""}>{label}</Link>
        );
      })}
    </nav>
  );
}
