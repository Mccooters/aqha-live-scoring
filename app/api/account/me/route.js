import { NextResponse } from "next/server";
import { adminClient } from "../../_lib/registrations";
import { getMemberAccount, escapeIlike, notSignedIn } from "../../_lib/memberAuth";
import { renewalOffer } from "../../_lib/memberships";
import { activeSeasons, currentSeason } from "../../../../lib/membershipSeason";

// Reads the session cookie, so it can never be pre-rendered at build time.
export const dynamic = "force-dynamic";

// Everything the member portal shows: the account email plus every
// membership application under that email (all seasons, all statuses), each
// with its people and horses. Internal Square IDs are stripped; the checkout
// link is kept only while a payment is still owed.
export async function GET() {
  try {
    const db = adminClient();
    const account = await getMemberAccount(db);
    if (!account) return NextResponse.json(notSignedIn(), { status: 401 });

    const baseSelect = "*, horses:club_member_horses(*)";
    const order = (q) =>
      q.order("season", { ascending: false }).order("created_at", { ascending: false });
    let { data: rows, error } = await order(
      db
        .from("club_members")
        .select(`${baseSelect}, people:club_member_people(*)`)
        .ilike("email", escapeIlike(account.email))
    );
    if (error) {
      // club_member_people arrives with v25 — if only part of the migration
      // has been run, still show everything else rather than a dead portal.
      const retry = await order(
        db
          .from("club_members")
          .select(baseSelect)
          .ilike("email", escapeIlike(account.email))
      );
      if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
      rows = (retry.data ?? []).map((row) => ({ ...row, people: [] }));
    }

    // Applications from before v25 have no included_people snapshot — fall
    // back to the type's current setting so the portal shows the People card
    // for them (the people route applies the same fallback when adding).
    const missingTypeIds = [...new Set(
      (rows ?? [])
        .filter((r) => r.included_people == null && r.membership_type_id)
        .map((r) => r.membership_type_id)
    )];
    let typePeople = {};
    if (missingTypeIds.length) {
      const { data: types } = await db
        .from("membership_types")
        .select("id, included_people")
        .in("id", missingTypeIds);
      (types ?? []).forEach((t) => { typePeople[t.id] = t.included_people; });
    }

    const current = currentSeason();
    const seasons = activeSeasons();
    const memberships = (rows ?? [])
      .map((row) => {
        const isActiveSeason = seasons.includes(row.season);
        const isCurrentSeason = row.season === current;
        const { square_order_id, square_payment_id, square_checkout_url, ...rest } = row;
        return {
          ...rest,
          included_people: row.included_people ?? typePeople[row.membership_type_id] ?? null,
          square_checkout_url: row.status === "pending" ? square_checkout_url : undefined,
          is_active_season: isActiveSeason,
          is_current: isCurrentSeason && row.status === "approved",
          is_upcoming: isActiveSeason && !isCurrentSeason && row.status === "approved",
          editable: row.status !== "rejected",
          people: (row.people ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
          horses: (row.horses ?? []).sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
        };
      });

    // During July, tell the portal and the event entry form whether a renewal
    // for the coming season can be offered (null the rest of the year).
    let renewal = null;
    try {
      renewal = await renewalOffer(db, account.email);
    } catch {
      renewal = null;
    }

    return NextResponse.json({
      email: account.email,
      has_password: !!account.password_hash,
      memberships,
      has_current_membership: memberships.some((m) => m.is_current),
      renewal_offer: renewal
        ? {
            season: renewal.season,
            previous_type_id: renewal.latest.membership_type_id,
            previous_type_name: renewal.latest.membership_type_name,
          }
        : null,
    });
  } catch (err) {
    console.error("account/me error:", err);
    return NextResponse.json({ error: err.message ?? "Unexpected error" }, { status: 500 });
  }
}
