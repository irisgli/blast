import { getDemoBrief } from "../brief";
import { REPO_URL, SITE_URL } from "../site";

/**
 * How a diff becomes a decision, in one line, and a claim a reader can falsify.
 */

const STAGES = ["change", "evidence", "snapshot", "rules", "decision", "surfaces"] as const;

export function Pipeline() {
  return (
    <ol className="pipe" data-reveal="pipe" aria-label="How a diff becomes a decision">
      {STAGES.map((stage) => (
        <li className="pipe__stage" key={stage}>
          {stage}
        </li>
      ))}
    </ol>
  );
}

/**
 * Both panes print what the deployment answers and what a clone reproduces, and both
 * values come from the `produceBrief` call that rendered this page. If the digests differ
 * the page is wrong, and a reader can say so with evidence rather than a feeling.
 */
export async function Verify() {
  const result = await getDemoBrief();
  if (!result.ok) return null;

  const { brief, profile } = result.value;
  const production = [
    `$ curl -sI ${SITE_URL}/api/brief | grep -i x-blast-`,
    `x-blast-verdict: ${brief.verdict}`,
    `x-blast-confidence: ${brief.confidence}`,
    `x-blast-digest: ${brief.digest}`,
  ].join("\n");
  const clone = [
    `$ git clone ${REPO_URL} && cd blast`,
    "$ pnpm install && pnpm build",
    `$ pnpm blast decide fixture --intent "${profile.intent}" --no-log | jq -r .digest`,
    brief.digest,
  ].join("\n");

  return (
    <div className="verify">
      <div className="verify__block">
        <p className="verify__label">Ask production</p>
        <pre className="verify__pre">
          <code>{production}</code>
        </pre>
      </div>
      <div className="verify__block">
        <p className="verify__label">Reproduce from a clone</p>
        <pre className="verify__pre">
          <code>{clone}</code>
        </pre>
      </div>
      <p className="verify__note">
        Five module boundaries are checked by{" "}
        <a href={`${REPO_URL}/blob/main/scripts/check-module-boundaries.mjs`}>one script</a> on
        every test run. Same digest, same decision.
      </p>
    </div>
  );
}
