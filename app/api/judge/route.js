import { NextResponse } from "next/server";
import { adminClient } from "../_lib/registrations";
import { fillChampionshipsFedBy } from "../_lib/championships";
import { CARD_FAMILIES, layoutFor, cleanPatternResult, patternTotals, patternScored } from "../../../lib/judgeCards";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Digital judge cards (schema-v63). The judge opens the per-judge link the
// coordinator shared; its code unlocks ONLY these actions, on this one event,
// for the classes that name this judge:
//   check    — is this code good? (judge name, entry mode)
//   snapshot — the whole show for this judge, downloaded to the device so
//              scoring works with no reception
//   submit   — a signed card: writes that judge's column on the entries,
//              closes the class once every judge has signed
//   setup    — the obstacle / manoeuvre names + tie-breaker order for a
//              pattern card (schema-v64), saved on the class so the other
//              judge's card shows the same boxes
// It is not a staff login — no dashboard, no money, no member data, and the
// other judge's card is only returned once this judge has signed. Writes go
// through the service role here because the judge has no Supabase session.
//
// Sending is safe to repeat: the card id is minted on the device, so a card
// that arrives twice (the signal dropped mid-send) is accepted once.

const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

const migrationHint = (msg) => /judge_card_type|judge_card_config|layout/i.test(msg ?? "")
  ? 'Pattern judge cards need a database update — the coordinator must run "schema-v64-pattern-cards.sql".'
  : /judge_codes|judge_cards|judge_entry_mode|schema cache|does not exist/i.test(msg ?? "")
  ? 'Judge cards need a database update — the coordinator must run "schema-v63-judge-cards.sql".'
  : msg;
const isV64Missing = (msg) => /judge_card_type|judge_card_config/i.test(msg ?? "");

// Which judge slot a judge holds on a class: 1 = classes.judge (score),
// 2 = classes.judge2 (score2). null = not this judge's class.
function slotFor(cls, judgeName) {
  if (sameName(cls.judge, judgeName)) return 1;
  if (cls.judge2 && sameName(cls.judge2, judgeName)) return 2;
  return null;
}

const CLASS_FIELDS_V63 = "id, event_id, num, name, judge, judge2, status, sort_order, day, scoring_mode, pattern_url, hidden, program_category, champ_feeder_ids, champ_take";
const CLASS_FIELDS = `${CLASS_FIELDS_V63}, judge_card_type, judge_card_config`;
const ENTRY_FIELDS = "id, class_id, back_number, horse, exhibitor, draw_order, score, score2, scratched, called";

// Classes with their entries. A database that hasn't had schema-v64 yet
// (no card type / box names on classes) still serves the stage-1 cards.
async function selectClasses(db, apply) {
  let res = await apply(db.from("classes").select(`${CLASS_FIELDS}, entries(${ENTRY_FIELDS})`));
  if (res.error && isV64Missing(res.error.message)) {
    res = await apply(db.from("classes").select(`${CLASS_FIELDS_V63}, entries(${ENTRY_FIELDS})`));
  }
  return res;
}

async function loadJudgeClasses(db, eventId, judgeName) {
  const { data, error } = await selectClasses(db, (q) => q.eq("event_id", eventId).order("sort_order"));
  if (error) throw new Error(error.message);
  const mine = (data ?? []).filter((c) => !c.hidden && slotFor(c, judgeName));
  mine.forEach((c) => {
    c.judge_slot = slotFor(c, judgeName);
    c.entries = (c.entries ?? []).sort((a, b) => (a.draw_order ?? 0) - (b.draw_order ?? 0));
  });
  return mine;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { event_id, code, action } = body ?? {};
    if (!event_id || !code || !action) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const db = adminClient();

    const { data: codeRow, error: cErr } = await db
      .from("judge_codes")
      .select("id, judge_name, revoked")
      .eq("event_id", event_id)
      .eq("code", String(code))
      .maybeSingle();
    if (cErr) return NextResponse.json({ error: migrationHint(cErr.message) }, { status: 500 });
    if (!codeRow || codeRow.revoked) {
      return NextResponse.json({ error: "That judge link isn't valid for this event — ask the coordinator for the current link." }, { status: 403 });
    }
    const judgeName = codeRow.judge_name;
    db.from("judge_codes").update({ last_seen_at: new Date().toISOString() }).eq("id", codeRow.id).then(() => {}, () => {});

    const { data: event, error: eErr } = await db
      .from("events")
      .select("id, name, status, starts_on, ends_on, event_type, judge_entry_mode, break_until, break_label")
      .eq("id", event_id)
      .maybeSingle();
    if (eErr || !event) return NextResponse.json({ error: eErr ? migrationHint(eErr.message) : "Event not found" }, { status: eErr ? 500 : 404 });

    if (action === "check") {
      return NextResponse.json({ ok: true, judge_name: judgeName, entry_mode: event.judge_entry_mode ?? "judge", event: { id: event.id, name: event.name, status: event.status } });
    }

    if (action === "snapshot") {
      const classes = await loadJudgeClasses(db, event_id, judgeName);
      const ids = classes.map((c) => c.id);
      let cards = [];
      if (ids.length) {
        const { data, error } = await db.from("judge_cards").select("*").in("class_id", ids);
        if (error) return NextResponse.json({ error: migrationHint(error.message) }, { status: 500 });
        cards = data ?? [];
      }
      const byClass = Object.fromEntries(classes.map((c) => [c.id, c]));
      // This judge's own cards always come back (so a reinstalled phone or a
      // second device picks up where the judge left off). The OTHER judge's
      // card only once this judge has signed, or the class is closed —
      // owner's rule: judges never see each other's marks while scoring.
      const mineSigned = new Set(cards.filter((k) => byClass[k.class_id]?.judge_slot === k.judge_slot).map((k) => k.class_id));
      const visible = cards.filter((k) => {
        const cls = byClass[k.class_id];
        if (!cls) return false;
        if (cls.judge_slot === k.judge_slot) return true;
        return cls.status === "completed" || mineSigned.has(k.class_id);
      });
      return NextResponse.json({
        ok: true,
        fetched_at: new Date().toISOString(),
        judge_name: judgeName,
        entry_mode: event.judge_entry_mode ?? "judge",
        event,
        classes,
        cards: visible,
      });
    }

    if (action === "submit") {
      const card = body.card ?? {};
      if (!card.id || !card.class_id || !Array.isArray(card.results)) {
        return NextResponse.json({ error: "Card is incomplete" }, { status: 400 });
      }
      const { data: cls, error: clsErr } = await selectClasses(db, (q) => q.eq("id", card.class_id).maybeSingle());
      if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 500 });
      if (!cls || cls.event_id !== event_id) return NextResponse.json({ error: "Class not found" }, { status: 404 });
      const slot = slotFor(cls, judgeName);
      if (!slot) return NextResponse.json({ error: `You are not listed as a judge on Class ${cls.num}.` }, { status: 403 });

      const { data: existing, error: exErr } = await db
        .from("judge_cards").select("*").eq("class_id", cls.id).eq("judge_slot", slot).maybeSingle();
      if (exErr) return NextResponse.json({ error: migrationHint(exErr.message) }, { status: 500 });
      const version = Math.max(1, parseInt(card.version, 10) || 1);
      if (existing) {
        // The same signed card arriving again (a retry) is simply "done".
        if (existing.id === card.id && existing.version >= version && existing.status === "signed") {
          return NextResponse.json({ ok: true, duplicate: true, class_status: cls.status });
        }
        // Once the class is closed the card is final — like the paper card,
        // "no changes except clerical errors": staff unlock it first.
        if (cls.status === "completed" && existing.status !== "unlocked") {
          return NextResponse.json({ error: `Class ${cls.num} is closed and your card is locked — ask the secretary to unlock it if a correction is needed.`, locked: true }, { status: 409 });
        }
      }

      // Validate the results against the class as it stands now: every
      // entry must belong to the class; placings unique and 1..n. Pattern
      // cards: the boxes are the record — the score is worked out again here
      // (70 + content [+ F&E] − penalties), never taken from the device.
      const entryById = Object.fromEntries((cls.entries ?? []).map((e) => [e.id, e]));
      const cardType = CARD_FAMILIES[card.card_type] ? card.card_type : "placings";
      const family = CARD_FAMILIES[cardType];
      const isPattern = family.kind === "pattern";
      const layout = isPattern ? layoutFor(cls, family, card.layout) : null;
      const seenPlaces = new Set();
      const clean = [];
      for (const r of card.results) {
        const entry = entryById[r?.entry_id];
        if (!entry) continue; // deleted since the judge scored it — nothing to write
        const dq = Boolean(r.dq);
        let place = r.place == null || r.place === "" ? null : parseInt(r.place, 10);
        let score = r.score == null || r.score === "" ? null : Number(r.score);
        if (place != null && (!Number.isInteger(place) || place < 1)) place = null;
        if (score != null && !Number.isFinite(score)) score = null;
        let pattern = null;
        if (isPattern) {
          pattern = cleanPatternResult(r, family, layout.boxes.length);
          pattern.tie_rank = Number.isInteger(r.tie_rank) ? r.tie_rank : null;
          score = patternScored(pattern) && !dq ? patternTotals(pattern, family).score : null;
          if (score == null) place = null;
        }
        if (place != null) {
          if (seenPlaces.has(place)) return NextResponse.json({ error: `Two horses are both placed ${place} — fix the card and finish again.` }, { status: 400 });
          seenPlaces.add(place);
        }
        clean.push({ entry_id: entry.id, back_number: entry.back_number, place, score, dq, note: String(r.note ?? "").slice(0, 300) || null, ...(pattern ?? {}) });
      }

      const signedAt = card.signed_at && !isNaN(Date.parse(card.signed_at)) ? new Date(card.signed_at).toISOString() : new Date().toISOString();
      const row = {
        id: card.id,
        class_id: cls.id,
        judge_slot: slot,
        judge_name: judgeName,
        card_type: cardType,
        status: "signed",
        results: clean,
        notes: String(card.notes ?? "").slice(0, 2000) || null,
        entered_by: String(card.entered_by ?? "").slice(0, 120) || null,
        device_id: String(card.device_id ?? "").slice(0, 80) || null,
        version,
        signed_at: signedAt,
        received_at: new Date().toISOString(),
        unlocked_at: null,
        unlocked_by: null,
      };
      if (isPattern) row.layout = layout;
      // One card per class per judge: a re-send after an unlock replaces the
      // old one (the unique index on class_id + judge_slot arbitrates).
      if (existing && existing.id !== card.id) {
        const { error: delErr } = await db.from("judge_cards").delete().eq("id", existing.id);
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      let { error: upErr } = await db.from("judge_cards").upsert(row, { onConflict: "id" });
      if (upErr && isPattern && /layout/i.test(upErr.message)) {
        // Pre-v64 database: keep the card (the boxes are inside results).
        delete row.layout;
        ({ error: upErr } = await db.from("judge_cards").upsert(row, { onConflict: "id" }));
      }
      if (upErr) return NextResponse.json({ error: migrationHint(upErr.message) }, { status: 500 });
      // First card in with box names: keep them on the class for the other
      // judge (and the dashboard). Never overwrites names already saved.
      if (isPattern && layout.boxes.some(Boolean) && !(Array.isArray(cls.judge_card_config?.boxes) && cls.judge_card_config.boxes.some(Boolean))) {
        await db.from("classes").update({ judge_card_config: layout }).eq("id", cls.id).then(() => {}, () => {});
      }

      // Write this judge's column on the entries. The card is the only
      // source of this judge's marks: a horse the judge left unplaced is
      // cleared (a value typed on the dashboard earlier is replaced), and a
      // DQ is stored as -1 like everywhere else. Scratched entries are left
      // alone. Horses with a result have plainly been through the ring.
      const field = slot === 1 ? "score" : "score2";
      const byEntry = Object.fromEntries(clean.map((r) => [r.entry_id, r]));
      for (const entry of cls.entries ?? []) {
        if (entry.scratched) continue;
        const r = byEntry[entry.id];
        let value = null;
        if (r) {
          if (r.dq) value = -1;
          else if (cardType === "scores" || isPattern) value = r.score;
          else value = r.place;
        }
        const patch = { [field]: value };
        if (value != null) patch.called = true;
        if ((entry[field] ?? null) === value && (value == null || entry.called)) continue;
        const { error } = await db.from("entries").update(patch).eq("id", entry.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Placings on a class still set to a score scale would sort backwards
      // (6/5 reads as a higher score) — same switch the results importer makes.
      const mode = cls.scoring_mode ?? "score";
      if (cardType === "placings" && (mode === "score" || mode === "tbc")) {
        await db.from("classes").update({ scoring_mode: "placing" }).eq("id", cls.id);
      } else if ((cardType === "scores" || isPattern) && mode !== "score") {
        // A pattern card's totals are scores (70-base): a class left on a
        // placing / TBC mode would read them as placings.
        await db.from("classes").update({ scoring_mode: "score" }).eq("id", cls.id);
      }

      // Close the class once every judge has signed (owner's rule, Oct 2026:
      // "once the judge hits finish class it closes it"). Then move the show
      // along like the gate does: start the next class in running order.
      const expected = cls.judge2 ? 2 : 1;
      const { data: all } = await db.from("judge_cards").select("judge_slot, status").eq("class_id", cls.id);
      const signedSlots = new Set((all ?? []).filter((k) => k.status === "signed").map((k) => k.judge_slot));
      const allSigned = Array.from({ length: expected }, (_, i) => i + 1).every((s) => signedSlots.has(s));
      let closed = false;
      let next = null;
      if (allSigned && cls.status !== "completed") {
        const wasLive = cls.status === "live";
        const { error: doneErr } = await db.from("classes").update({ status: "completed" }).eq("id", cls.id);
        if (doneErr) return NextResponse.json({ error: doneErr.message }, { status: 500 });
        closed = true;
        if (wasLive && event.status === "live") {
          const { data: rest } = await db
            .from("classes").select("id, num, name, sort_order, status, hidden").eq("event_id", event_id).order("sort_order");
          const nextUp = (rest ?? []).find((c) => c.status === "upcoming" && !c.hidden && (c.sort_order ?? 0) > (cls.sort_order ?? 0));
          if (nextUp) {
            await db.from("classes").update({ status: "live" }).eq("id", nextUp.id);
            next = `Class ${nextUp.num} · ${nextUp.name}`;
          }
        }
        await fillChampionshipsFedBy(db, event_id, cls.id);
      } else if (cls.status === "completed") {
        // A corrected card on an already-closed class: feed the championships
        // again in case the qualifiers changed.
        await fillChampionshipsFedBy(db, event_id, cls.id);
      }

      return NextResponse.json({ ok: true, class_status: closed ? "completed" : cls.status, closed, waiting_for_other_judge: !allSigned, next });
    }

    if (action === "setup") {
      // Box names + tie-breaker order for a pattern class, shared through
      // the class row. Either judge may set them until the class closes.
      const { class_id, config } = body;
      const { data: cls, error: clsErr } = await selectClasses(db, (q) => q.eq("id", class_id).maybeSingle());
      if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 500 });
      if (!cls || cls.event_id !== event_id) return NextResponse.json({ error: "Class not found" }, { status: 404 });
      if (!slotFor(cls, judgeName)) return NextResponse.json({ error: `You are not listed as a judge on Class ${cls.num}.` }, { status: 403 });
      if (cls.status === "completed") return NextResponse.json({ error: `Class ${cls.num} is closed.` }, { status: 409 });
      const boxes = (Array.isArray(config?.boxes) ? config.boxes : []).slice(0, 12).map((b) => String(b ?? "").slice(0, 40));
      if (!boxes.length) return NextResponse.json({ error: "No boxes" }, { status: 400 });
      const tiebreak = (Array.isArray(config?.tiebreak) ? config.tiebreak : []).map((i) => parseInt(i, 10)).filter((i) => Number.isInteger(i) && i >= 0 && i < boxes.length);
      const { error } = await db.from("classes").update({ judge_card_config: { boxes, tiebreak: Array.from(new Set(tiebreak)) } }).eq("id", cls.id);
      if (error) return NextResponse.json({ error: migrationHint(error.message) }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Judge route error:", err);
    return NextResponse.json({ error: migrationHint(err.message) ?? "Something went wrong" }, { status: 500 });
  }
}
