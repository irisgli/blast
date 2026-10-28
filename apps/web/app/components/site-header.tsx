import { BlastMark, ExternalIcon } from "./icons";
import { DOCS_URL, REPO_URL } from "./../site";

/** The top bar: the mark, three anchors, the repository. */
export function SiteHeader() {
  return (
    <header className="topbar">
      <nav className="shell topbar__inner" aria-label="Primary">
        <a className="topbar__brand" href="#top">
          <BlastMark />
          <span>blast.</span>
        </a>
        <div className="topbar__links">
          <a href="#budgets">Playground</a>
          <a href="#setup">Setup</a>
          <a href="#engineering">How it decides</a>
          <a href={`${DOCS_URL}/api.md`}>API</a>
        </div>
        <a className="btn btn--small" href={REPO_URL}>
          GitHub
          <ExternalIcon />
        </a>
      </nav>
    </header>
  );
}
