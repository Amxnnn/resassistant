import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BRAND } from "./brand";

// The mark: the orb drawn as a few rows of dots, smaller toward the rim.
const DOTS: [number, number, number][] = [
  [-3.6, -7.8, 1], [0, -7.8, 1.1], [3.6, -7.8, 1],
  [-6, -3.9, 1.05], [-2, -3.9, 1.35], [2, -3.9, 1.35], [6, -3.9, 1.05],
  [-8, 0, 0.95], [-4, 0, 1.35], [0, 0, 1.45], [4, 0, 1.35], [8, 0, 0.95],
  [-6, 3.9, 1.05], [-2, 3.9, 1.35], [2, 3.9, 1.35], [6, 3.9, 1.05],
  [-3.6, 7.8, 1], [0, 7.8, 1.1], [3.6, 7.8, 1]
];

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      {DOTS.map(([x, y, r]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={r} opacity={r > 1.2 ? 1 : 0.62} />
      ))}
    </svg>
  );
}

export function SiteNav({ page }: { page: "home" | "demo" | "auth" }) {
  return (
    <header className="site-nav">
      <Link href="/" className="site-brand" aria-label={`${BRAND.name} home`}>
        <Mark />
        <span>{BRAND.name}</span>
      </Link>
      <nav className="site-nav-actions" aria-label="Site">
        {page !== "auth" && (
          <Link href="/login" className="site-link">
            Staff sign in
          </Link>
        )}
        {page !== "demo" && (
          <Link href="/demo" className="pill pill-light pill-sm">
            Try the demo <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </header>
  );
}
