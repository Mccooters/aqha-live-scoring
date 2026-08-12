"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

// Committee read-only accounts (schema-v48): a quiet banner on the staff
// pages so a viewer knows why every save is refused. Renders nothing for
// normal staff — and on databases without the migration, where there are no
// viewers.
export default function ReadOnlyBanner() {
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      const { data: row, error } = await supabase
        .from("staff_viewers")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (!cancelled && !error && row) setReadOnly(true);
    });
    return () => { cancelled = true; };
  }, []);
  if (!readOnly) return null;
  return (
    <div className="card" style={{ padding: "10px 14px", border: "1px solid #E0B15A", background: "#FFF7D6", marginBottom: 14 }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: "var(--leather)" }}>
        👁 Committee view — read-only. You can see everything here, but this account can&apos;t change anything.
      </p>
    </div>
  );
}
