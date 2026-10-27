import { getDemoBrief } from "../brief";
import { REPO_URL, SITE_URL } from "../site";

/**
 * How a diff becomes a decision, and the boundaries that keep it that way.
 *
 * Six stages in one strip, each with one line. Under them the five invariants
 * `scripts/check-module-boundaries.mjs` checks on every test run, because a reader
 * deciding whether to trust the output is really deciding whether to trust the shape.
 */

const STAGES = [
  {
    title: "Change",
    body: "A diff becomes a profile: surfaces, endpoints, cache directives, dependencies.",
  },
  {
    title: "Evidence",
    body: "Nine sources and two ingest adapters return records. Every number carries a basis.",
  },
  {
    title: "Snapshot",
    body: "Evidence is frozen and content-addressed before anything decides.",
  },
  {
    title: "Rules",
    body: "Built-ins are declared in the shape blast.json uses. The model never picks a verdict.",
  },
  {
    title: "Decision",
    body: "Verdict, confidence, every rule that fired, a digest, and a signature when there is a key.",
  },
  {
    title: "Surfaces",
    body: "A comment, an exit code, POST /api/v1/decision, this page, and an append-only audit log.",
  },
] as const;

const LAWS = [
  "layering",
  "core-is-pure",
  "core-reads-no-environment",
  "processes-start-in-vcs",
  "engine-is-driven-through-produce-brief",
] as const;

export function Pipeline() {
  return (
    <ol className="pipe">
      {STAGES.map((stage, index) => (
        <li className="pipe__stage" key={stage.title}>
          <span className="pipe__index mono">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="pipe__title">{stage.title}</h3>
          <p className="pipe__body">{stage.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Invariants() {
  return (
    <p className="laws">
      <span className="laws__lead">
        Five boundaries,{" "}
        <a href={`${REPO_URL}/blob/main/scripts/check-module-boundaries.mjs`}>one script</a>, every
        test run and every commit in CI:
      </span>
      {LAWS.map((law) => (
        <code className="laws__chip" key={law}>
          {law}
        </code>
      ))}
    </p>
  );
}

/**
 * A claim a reader can falsify.
 *
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
        <p className="verify__label">Verify against production</p>
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
        Both expected outputs were computed by the call that rendered this page. The digest is a
        content address over the change, the evidence, the budgets and the verdict; two runs that
        agree on it are the same decision, wherever they ran.
      </p>
    </div>
  );
}
