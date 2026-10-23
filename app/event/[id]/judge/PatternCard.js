"use client";
import { useState } from "react";
import { fmtBack, ordinal } from "../../../../lib/showPrint";
import { contentValues, fmtHalf, patternTotals, patternScored, patternTied, boxLabel } from "../../../../lib/judgeCards";

// Stage 2 pattern card (Trail, Western Riding, Ranch Riding, Showmanship /
// Horsemanship / Hunt Seat Eq). Laid out like the club's paper sheet but one
// horse at a time: the obstacle / manoeuvre boxes run down the screen, each
// with the content-score chips (-1½ … +1½ or -3 … +3) and penalty chips
// under it, and the running score (70 + content − penalties) sits at the
// top. The box names and tie-breaker order are set once per class (by the
// coordinator, or by the judge here before the first horse) and shared with
// the other judge's card.

const CHIP = { padding: "7px 0", fontSize: 15, fontWeight: 700, borderRadius: 9, border: "1px solid var(--line)", background: "#fff", fontFamily: "inherit", color: "var(--ink)", minWidth: 0 };
const CHIP_ON = { ...CHIP, background: "var(--leather)", color: "#fff", borderColor: "var(--leather)" };
const PEN = { ...CHIP, fontSize: 13.5, padding: "6px 10px", borderColor: "#E3B9AE", color: "var(--clay)" };
const TOKEN = { fontSize: 13, fontWeight: 800, padding: "4px 8px", borderRadius: 8, background: "#FBE9E4", color: "var(--clay)", border: "1px solid #E3B9AE", fontFamily: "inherit" };

const scoreOf = (r, family) => (patternScored(r) ? fmtHalf(patternTotals(r, family).score) : "");

export function PatternSetup({ family, layout, onChange, onClose }) {
  const [draft, setDraft] = useState(() => ({ boxes: [...layout.boxes], tiebreak: [...layout.tiebreak] }));
  const noun = family.boxNoun.toLowerCase();
  const setCount = (n) => {
    const count = Math.max(1, Math.min(family.maxBoxes, n));
    const boxes = Array.from({ length: count }, (_, i) => draft.boxes[i] ?? "");
    setDraft({ boxes, tiebreak: draft.tiebreak.filter((i) => i < count) });
  };
  const toggleTb = (i) => setDraft((d) => ({ ...d, tiebreak: d.tiebreak.includes(i) ? d.tiebreak.filter((x) => x !== i) : [...d.tiebreak, i] }));
  return (
    <div style={{ padding: "10px 12px 14px", borderTop: "1px solid var(--line)", background: "#FBF8F2" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>How many {noun}s?</b>
        <button className="btn-ghost" onClick={() => setCount(draft.boxes.length - 1)} disabled={draft.boxes.length <= 1}>−</button>
        <span className="display" style={{ fontSize: 20, fontWeight: 800, minWidth: 28, textAlign: "center" }}>{draft.boxes.length}</span>
        <button className="btn-ghost" onClick={() => setCount(draft.boxes.length + 1)} disabled={draft.boxes.length >= family.maxBoxes}>+</button>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {draft.boxes.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 22, fontWeight: 800, textAlign: "right", color: "var(--quiet)" }}>{i + 1}</span>
            <input className="field" style={{ flex: 1, fontSize: 15, padding: "7px 10px" }} placeholder={`${family.boxNoun} ${i + 1} (e.g. ${family.boxNoun === "Obstacle" ? "Bridge, Gate, Back" : "Walk, Jog, Lope"})`}
              value={b} onChange={(e) => setDraft((d) => { const boxes = [...d.boxes]; boxes[i] = e.target.value.slice(0, 40); return { ...d, boxes }; })} />
            {family.tiebreak === "boxes" && (
              <button className="btn-ghost" style={{ minWidth: 58, fontWeight: 800, ...(draft.tiebreak.includes(i) ? { background: "var(--brass)", color: "#fff", borderColor: "var(--brass)" } : {}) }}
                onClick={() => toggleTb(i)} title="Tie-breaker order">
                {draft.tiebreak.includes(i) ? `TB ${draft.tiebreak.indexOf(i) + 1}` : "TB"}
              </button>
            )}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "var(--quiet)", margin: "8px 0 10px" }}>
        {family.tiebreak === "boxes"
          ? `Tap TB on the ${noun}s that break a tie, in order (TB 1 is checked first) — the same as numbering them on the paper sheet. Names are optional.`
          : "Ties are broken on penalties (fewer wins). Names are optional."}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 2, background: "var(--leather)" }} onClick={() => { onChange(draft); onClose(); }}>Save {noun}s</button>
      </div>
    </div>
  );
}

// One horse's sheet: every box with its chips, running score at the top.
function HorseSheet({ cls, entry, result, family, layout, locked, onPatch, onDq, onPrev, onNext, onDone, index, total }) {
  const r = result ?? {};
  const boxes = Array.isArray(r.boxes) ? r.boxes : [];
  const totals = patternTotals(r, family);
  const values = contentValues(family);
  const setBox = (i, patch) => {
    const next = layout.boxes.map((_, k) => ({ c: boxes[k]?.c ?? null, p: [...(boxes[k]?.p ?? [])] }));
    next[i] = { ...next[i], ...patch };
    onPatch({ boxes: next, scored: true });
  };
  const addPen = (i, v) => setBox(i, { p: [...(boxes[i]?.p ?? []), v] });
  const dropPen = (i, k) => setBox(i, { p: (boxes[i]?.p ?? []).filter((_, j) => j !== k) });
  const scored = patternScored(r);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--line)", position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
        <button className="btn-ghost" onClick={onPrev} disabled={!onPrev} aria-label="Previous horse">◀</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="display" style={{ fontSize: 19, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#{fmtBack(entry.back_number)} <span style={{ fontWeight: 600 }}>{entry.horse}</span></div>
          <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>{entry.exhibitor} · {index + 1} of {total}</div>
        </div>
        <button className="btn-ghost" onClick={onNext} disabled={!onNext} aria-label="Next horse">▶</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 12px 8px", background: r.dq ? "#FBE9E4" : "#FBF4E4" }}>
        <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>
          {r.dq ? <b style={{ color: "var(--clay)" }}>{family.offPattern ? "ZERO SCORE" : "DQ"} — not placed</b>
            : <>content <b style={{ color: "var(--ink)" }}>{fmtHalf(totals.content, { sign: true }) || "0"}</b>{family.fe && <> · F&amp;E <b style={{ color: "var(--ink)" }}>{r.fe ?? "—"}</b></>} · penalties <b style={{ color: "var(--clay)" }}>{fmtHalf(totals.penalties) || "0"}</b>{r.off_pattern && <> · <b style={{ color: "#A05000" }}>OFF PATTERN</b></>}</>}
        </div>
        <div className="display" style={{ fontSize: 26, fontWeight: 800, color: r.dq ? "var(--clay)" : "var(--ink)" }}>{r.dq ? "—" : scored ? fmtHalf(totals.score) : <span style={{ color: "var(--quiet)", fontSize: 16 }}>not scored</span>}</div>
      </div>

      {layout.boxes.map((name, i) => {
        const b = boxes[i] ?? { c: null, p: [] };
        const tb = layout.tiebreak.indexOf(i);
        return (
          <div key={i} style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--line)", opacity: r.dq ? 0.55 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <b style={{ fontSize: 14.5 }}>{boxLabel(family, layout, i)}{tb >= 0 && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: "var(--brass)", letterSpacing: ".06em" }}>TB {tb + 1}</span>}</b>
              <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>{b.c != null ? fmtHalf(b.c, { sign: true }) || "0" : "—"}{b.p.length ? <span style={{ color: "var(--clay)" }}> · −{fmtHalf(b.p.reduce((s, p) => s + p, 0))}</span> : ""}</span>
            </div>
            {!locked ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(values.length, 7)}, 1fr)`, gap: 4 }}>
                  {values.map((v) => (
                    <button key={v} style={b.c === v ? CHIP_ON : CHIP} onClick={() => setBox(i, { c: b.c === v ? null : v })}>{v === 0 ? "0" : fmtHalf(v, { sign: true })}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--clay)", letterSpacing: ".06em" }}>PENALTY</span>
                  {family.penalties.map((v) => <button key={v} style={PEN} onClick={() => addPen(i, v)}>−{fmtHalf(v)}</button>)}
                  {b.p.map((v, k) => <button key={`t${k}`} style={TOKEN} onClick={() => dropPen(i, k)} title="Tap to remove">−{fmtHalf(v)} ✕</button>)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13.5 }}>
                Score <b>{b.c != null ? fmtHalf(b.c, { sign: true }) || "0" : "—"}</b>
                {b.p.length > 0 && <> · penalties {b.p.map((v) => `−${fmtHalf(v)}`).join(", ")}</>}
              </div>
            )}
          </div>
        );
      })}

      {family.fe && (
        <div style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--line)", opacity: r.dq ? 0.55 : 1 }}>
          <b style={{ fontSize: 14.5 }}>Form &amp; Effectiveness</b>
          <div style={{ fontSize: 12, color: "var(--quiet)", margin: "2px 0 6px" }}>E = 5 · VG = 4 · G = 3 · A = 0–2 — added to the score</div>
          {!locked ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
              {[0, 1, 2, 3, 4, 5].map((v) => <button key={v} style={r.fe === v ? CHIP_ON : CHIP} onClick={() => onPatch({ fe: r.fe === v ? null : v, scored: true })}>{v}</button>)}
            </div>
          ) : <div style={{ fontSize: 13.5 }}>F&amp;E <b>{r.fe ?? "—"}</b></div>}
        </div>
      )}

      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--line)" }}>
        {!locked && (
          <input className="field" style={{ fontSize: 13.5, padding: "6px 9px", width: "100%", marginBottom: 8 }} placeholder="Comment for this horse (optional)"
            value={r.note ?? ""} onChange={(e) => onPatch({ note: e.target.value })} />
        )}
        {locked && r.note && <div style={{ fontSize: 13.5, fontStyle: "italic", marginBottom: 8 }}>{r.note}</div>}
        {!locked && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {family.offPattern && (
              <button className="btn-ghost" style={r.off_pattern ? { background: "#A05000", color: "#fff", borderColor: "#A05000" } : { color: "#A05000", borderColor: "#A05000" }}
                onClick={() => onPatch({ off_pattern: !r.off_pattern, scored: true })}>{r.off_pattern ? "✓ Off pattern" : "Off pattern"}</button>
            )}
            <button className="btn-ghost" style={r.dq ? { background: "var(--clay)", color: "#fff", borderColor: "var(--clay)" } : { color: "var(--clay)", borderColor: "var(--clay)" }} onClick={onDq}>
              {r.dq ? `✓ ${family.offPattern ? "Zero score" : "DQ"} — undo` : family.offPattern ? "Zero score" : "DQ"}
            </button>
          </div>
        )}
        {!locked && (
          <button className="btn" style={{ width: "100%", background: "var(--leather)", fontSize: 16, padding: 12 }} onClick={onDone}>
            {onNext ? "✓ Done — next horse" : "✓ Done"}
          </button>
        )}
        {!locked && !scored && !r.dq && <p style={{ fontSize: 12, color: "var(--quiet)", margin: "8px 0 0" }}>Boxes you leave blank count as 0 (correct) once you tap Done.</p>}
      </div>
    </div>
  );
}

export default function PatternCard({ cls, card, family, layout, locked, order, setResult, toggleDq, move, setLayout, horseId, setHorseId }) {
  const [setup, setSetup] = useState(false);
  const active = cls.entries.filter((e) => !e.scratched);
  const results = card.results ?? {};
  const placeOf = Object.fromEntries(order.map((e, i) => [e.id, i + 1]));
  const noun = family.boxNoun.toLowerCase();
  const named = layout.boxes.filter(Boolean).length;
  const needsSetup = !locked && named === 0 && Object.keys(results).length === 0;

  if (horseId) {
    const idx = active.findIndex((e) => e.id === horseId);
    const entry = active[idx];
    if (!entry) { setHorseId(null); return null; }
    return (
      <>
        <div style={{ padding: "8px 12px 0" }}>
          <button className="btn-ghost" onClick={() => setHorseId(null)}>← All horses</button>
        </div>
        <HorseSheet
          cls={cls} entry={entry} result={results[entry.id]} family={family} layout={layout} locked={locked} index={idx} total={active.length}
          onPatch={(patch) => setResult(entry.id, patch)}
          onDq={() => toggleDq(entry)}
          onPrev={idx > 0 ? () => setHorseId(active[idx - 1].id) : null}
          onNext={idx < active.length - 1 ? () => setHorseId(active[idx + 1].id) : null}
          onDone={() => {
            if (!results[entry.id]?.dq) setResult(entry.id, { scored: true });
            if (idx < active.length - 1) setHorseId(active[idx + 1].id); else setHorseId(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      {/* Box set-up (names + tie-breakers) */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "flex-start", background: needsSetup ? "#FBF4E4" : undefined }}>
        <div style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
          <b>{layout.boxes.length} {noun}{layout.boxes.length === 1 ? "" : "s"}</b>
          {named > 0 && <span style={{ color: "var(--quiet)" }}> · {layout.boxes.map((b, i) => `${i + 1}${b ? ` ${b}` : ""}`).join(" · ")}</span>}
          {family.tiebreak === "boxes" && layout.tiebreak.length > 0 && <div style={{ color: "var(--brass)", fontWeight: 700 }}>Tie-breakers: {layout.tiebreak.map((i) => i + 1).join(", ")}</div>}
          {needsSetup && <div style={{ color: "#A05000", fontWeight: 700 }}>Set up the {noun}s before the first horse — names and tie-breaker order.</div>}
        </div>
        {!locked && !setup && <button className="btn-ghost" onClick={() => setSetup(true)}>{needsSetup ? "Set up" : "Edit"}</button>}
      </div>
      {setup && <PatternSetup family={family} layout={layout} onChange={setLayout} onClose={() => setSetup(false)} />}

      {/* Placings so far */}
      {order.length > 0 && (
        <>
          <div style={{ padding: "10px 12px 4px", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, color: "var(--quiet)", borderTop: "2px solid var(--line)" }}>Placings ({order.length})</div>
          {order.map((e, i) => {
            const r = results[e.id];
            const wrap = (x) => ({ ...x, result: results[x.id] });
            const tieUp = i > 0 && patternTied(wrap(order[i - 1]), wrap(e), family, layout);
            const tieDown = i < order.length - 1 && patternTied(wrap(e), wrap(order[i + 1]), family, layout);
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "1px solid var(--line)", fontSize: 14 }}>
                <b className="display" style={{ color: "var(--clay)", minWidth: 36, fontSize: 17 }}>{ordinal(i + 1)}</b>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#{fmtBack(e.back_number)} {e.horse}{r.off_pattern ? <span style={{ color: "#A05000", fontWeight: 700 }}> · off pattern</span> : ""}</span>
                <b>{scoreOf(r, family)}</b>
                {(tieUp || tieDown) && <span style={{ fontSize: 11, color: "#A05000", fontWeight: 800 }}>tie</span>}
                {!locked && (tieUp || tieDown) && (
                  <span style={{ display: "inline-flex", gap: 2 }}>
                    <button className="btn-ghost" style={{ padding: "3px 7px" }} disabled={!tieUp} onClick={() => move(i, -1)}>▲</button>
                    <button className="btn-ghost" style={{ padding: "3px 7px" }} disabled={!tieDown} onClick={() => move(i, 1)}>▼</button>
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Horses in draw order — tap to score */}
      <div style={{ padding: "10px 12px 4px", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, color: "var(--quiet)", borderTop: "2px solid var(--line)" }}>Horses · draw order · tap to {locked ? "see the card" : "score"}</div>
      {active.map((e) => {
        const r = results[e.id];
        const scored = patternScored(r);
        return (
          <button key={e.id} onClick={() => setHorseId(e.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: "1px solid var(--line)", width: "100%", background: "#fff", border: 0, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "var(--line)", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="display" style={{ fontSize: 17, fontWeight: 700 }}>#{fmtBack(e.back_number)} <span style={{ fontWeight: 600 }}>{e.horse}</span></div>
              <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>{e.exhibitor}{r?.note ? ` · ${r.note}` : ""}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              {r?.dq ? <b style={{ color: "var(--clay)" }}>{family.offPattern ? "ZERO" : "DQ"}</b>
                : scored ? <><div className="display" style={{ fontSize: 20, fontWeight: 800 }}>{scoreOf(r, family)}</div><div style={{ fontSize: 11.5, color: "var(--clay)", fontWeight: 800 }}>{placeOf[e.id] ? ordinal(placeOf[e.id]) : ""}</div></>
                : <span style={{ fontSize: 12.5, color: "var(--quiet)", fontWeight: 700 }}>{locked ? "not scored" : "Score ›"}</span>}
            </div>
          </button>
        );
      })}
    </>
  );
}
