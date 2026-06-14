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
      position: "sticky",
      top: 0,
      background: "var(--leather-deep)",
      borderBottom: "2px solid rgba(168,132,60,.25)",
      display: "flex",
      zIndex: 150,
      paddingTop: "env(safe-area-inset-top)",
    }}>
      {NAV.map(({ href, label }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "13px 6px",
            textDecoration: "none",
            fontFamily: "'Archivo', sans-serif",
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: active ? "var(--brass-soft)" : "rgba(242,234,219,0.45)",
            borderBottom: active ? "2px solid var(--brass-soft)" : "2px solid transparent",
            marginBottom: "-2px",
          }}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
