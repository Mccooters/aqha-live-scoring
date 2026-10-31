"use client";
import { groupByTier, normaliseUrl, sponsoredByText, tierOf } from "../../lib/sponsors";

// Public sponsor displays (schema-v69). Logo sizes come from the tier — a
// Platinum logo is drawn big, Bronze small; Class/Ribbon and In-Kind
// sponsors are listed by name. A sponsor without a logo shows its name in a
// pill at that tier's size, so nobody is left off the board for want of a
// picture.

function SponsorLink({ sponsor, children, style }) {
  const href = normaliseUrl(sponsor.website_url);
  const base = { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6, textDecoration: "none", color: "inherit", ...style };
  if (!href) return <div style={base}>{children}</div>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer sponsored" style={base} title={sponsor.name}>
      {children}
    </a>
  );
}

export function SponsorLogo({ sponsor, size, dark = false }) {
  const s = Math.max(40, size || 72);
  if (sponsor.logo_url) {
    return (
      <img src={sponsor.logo_url} alt={sponsor.name}
        style={{ maxHeight: s, maxWidth: Math.round(s * 2.2), width: "auto", height: "auto", objectFit: "contain",
          background: "#fff", borderRadius: 10, padding: 8, border: "1px solid var(--line)" }} />
    );
  }
  return (
    <span className="display" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: Math.round(s * 0.6),
      padding: "6px 16px", borderRadius: 10, fontWeight: 700, fontSize: Math.max(13, Math.round(s / 5)),
      background: dark ? "rgba(255,255,255,.1)" : "#fff", border: `1px solid ${dark ? "rgba(255,255,255,.3)" : "var(--line)"}`,
      color: dark ? "#F5EFE4" : "var(--leather)", textAlign: "center",
    }}>{sponsor.name}</span>
  );
}

// "Our sponsors" board: one row per tier, biggest first.
export default function SponsorBoard({ sponsors, title = "Thank you to our sponsors", compact = false }) {
  const groups = groupByTier(sponsors);
  if (!groups.length) return null;
  return (
    <section className="card sponsor-board" style={{ padding: compact ? "14px 16px" : "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h2 className="display" style={{ margin: 0, fontWeight: 700, fontSize: 15, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--leather)" }}>
          {title}
        </h2>
        <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </div>
      {groups.map(({ tier, sponsors: list }) => (
        <div key={tier.key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass)", fontWeight: 800, marginBottom: 8 }}>
            {tier.key === "platinum" ? "Platinum · Event title sponsor" : tier.key === "class" ? "Class & ribbon sponsors" : tier.key === "in_kind" ? "With thanks for in-kind support" : `${tier.label} sponsors`}
          </div>
          {tier.logo > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: tier.key === "platinum" ? 20 : 14, alignItems: "flex-end", justifyContent: tier.key === "platinum" ? "center" : "flex-start" }}>
              {list.map((s) => (
                <SponsorLink key={s.id} sponsor={s}>
                  <SponsorLogo sponsor={s} size={compact ? Math.round(tier.logo * 0.7) : tier.logo} />
                  {s.logo_url && (tier.key === "platinum" || tier.key === "gold") && (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--leather)" }}>{s.name}</span>
                  )}
                  {(s.sponsored_for || s.blurb) && !compact && (
                    <span style={{ fontSize: 11.5, color: "var(--quiet)", maxWidth: 220, textAlign: "center" }}>{s.sponsored_for || s.blurb}</span>
                  )}
                </SponsorLink>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 8px" }}>
              {list.map((s) => {
                const href = normaliseUrl(s.website_url);
                const Tag = href ? "a" : "span";
                return (
                  <Tag key={s.id} {...(href ? { href, target: "_blank", rel: "noopener noreferrer sponsored" } : {})}
                    style={{ fontSize: 13, fontWeight: 600, color: "var(--leather)", textDecoration: "none", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 20, padding: "4px 11px" }}>
                    {s.name}{s.sponsored_for ? <span style={{ color: "var(--quiet)", fontWeight: 500 }}> · {s.sponsored_for}</span> : null}
                  </Tag>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// Platinum = Event Title Sponsor: "Proudly presented by" under the event
// name in the dark header.
export function TitleSponsorLine({ sponsors }) {
  const list = (sponsors ?? []).filter((s) => s.tier === "platinum");
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
      <span style={{ fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)", fontWeight: 700 }}>
        Proudly presented by
      </span>
      {list.map((s) => (
        <SponsorLink key={s.id} sponsor={s} style={{ flexDirection: "row", gap: 8 }}>
          <SponsorLogo sponsor={s} size={56} dark />
          {s.logo_url && <span style={{ fontSize: 13, fontWeight: 700, color: "#F5EFE4" }}>{s.name}</span>}
        </SponsorLink>
      ))}
    </div>
  );
}

// "Proudly sponsored by …" under a class name. `sponsors` = that class's
// sponsors only (see classSponsors in lib/sponsors.js).
export function ClassSponsorLine({ sponsors, dark = false, style }) {
  const text = sponsoredByText(sponsors);
  if (!text) return null;
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: dark ? "#F5D87B" : "var(--brass)", marginTop: 2, ...style }}>
      🏅 {text}
    </div>
  );
}

export { tierOf };
