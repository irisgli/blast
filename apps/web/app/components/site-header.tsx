import { BlastMark, ExternalIcon } from "./icons";
import { DOCS_URL, REPO_URL } from "./../site";

/**
 * The top bar: the mark, three anchors, the repository. A 2px hairline along its top is the
 * scroll progress gauge, moved by the motion layer.
 */
export function SiteHeader() {
  return (
    <header className="topbar">
      <span className="progress" data-progress aria-hidden="true" />
      <nav className="shell topbar__inner" aria-label="Primary">
        <a className="topbar__brand" href="#top">
          <BlastMark />
          <span>blast.</span>
        </a>
        <div className="topbar__links">
          <a href="#budgets">playground</a>
          <a href="#setup">setup</a>
          <a href="#engineering">how it decides</a>
          <a href={`${DOCS_URL}/api.md`}>api</a>
        </div>
        <a className="btn btn--small" href={REPO_URL}>
          GitHub
          <ExternalIcon />
        </a>
      </nav>
    </header>
  );
}
