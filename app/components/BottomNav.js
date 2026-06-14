"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/",            label: "Events"    },
  { href: "/highpoints",  label: "High Pts"  },
  { href: "/registry",    label: "Registry"  },
  { href: "/coordinator", label: "Staff"     },
];

export default function BottomNav() {
  const path = usePathname();

  const isActive = (href) => {
    if (href === "/") return path === "/" || path.startsWith("/event/");
    return path.startsWith(href);
  };

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "var(--leather-deep)",
      borderTop: "1px solid rgba(168,132,60,.35)",
      display: "flex",
      paddingBottom: "env(safe-area-inset-bottom)",
      zIndex: 150,
    }}>
      {NAV.map(({ href, label }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "14px 4px",
            textDecoration: "none",
            fontFamily: "'Archivo', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: active ? "var(--brass-soft)" : "rgba(242,234,219,0.4)",
            borderTop: active ? "2px solid var(--brass-soft)" : "2px solid transparent",
            marginTop: "-1px",
          }}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
