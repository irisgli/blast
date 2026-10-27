import { BlastMark } from "./icons";
import { DOCS_URL, REPO_URL } from "./../site";

const LINKS = [
  { label: "API", href: `${DOCS_URL}/api.md` },
  { label: "Policy", href: `${DOCS_URL}/policy.md` },
  { label: "Architecture", href: `${DOCS_URL}/architecture.md` },
  { label: "Running in CI", href: `${DOCS_URL}/ci.md` },
  { label: "Audit log", href: "/audit" },
  { label: "Contributing", href: `${REPO_URL}/blob/main/CONTRIBUTING.md` },
] as const;

/** One row: the mark, the links a reader actually follows, and what the telemetry is. */
export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="shell foot__inner">
        <span className="foot__brand">
          <BlastMark size={16} />
          blast.
        </span>
        <nav className="foot__links" aria-label="Documentation">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <p className="foot__note">
          Apache-2.0. The telemetry on this page is fixture data; one adapter file swaps in a live
          source.
        </p>
      </div>
    </footer>
  );
}
