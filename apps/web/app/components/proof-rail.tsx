import { exitCodeFor, rulesFor } from "@blast/core";
import type { Basis, Enforcement, Finding, Severity } from "@blast/core";
import { formatMeasure, metricLabel } from "@blast/brief";
import { getDemoBrief } from "../brief";
import type { DemoBrief } from "../brief";
import { CodeBlock } from "./code-block";
import type { CodeLine } from "./code-block";
import { ProofStack } from "./proof-stack";
import { REPO_URL, SITE_URL } from "../site";

/**
 * How a diff becomes a decision, as six sheets that stack as the reader scrolls.
 *
 * Each stage shows the thing that stage produced for the sample pull request, read off
 * the same `produceBrief` run that drew the instrument above: the diff, the findings with
 * their bases, the snapshot's content address, the rules in force and the ones that
 * fired, the decision record, and the surfaces that carry it. Nothing here is a
 * description of the pipeline; it is the pipeline's output, in order.
 */

interface Stage {
  id: string;
  label: string;
  title: string;
  body: string;
  metric: string;
  rows: [string, string][];
  artifact: React.ReactNode;
}

const BASIS_ORDER: Basis[] = ["measured", "modeled", "inferred", "assumed"];

function countBy<T extends string>(values: readonly T[], order: readonly T[]): [T, number][] {
  return order
    .map((key): [T, number] => [key, values.filter((value) => value === key).length])
    .filter(([, count]) => count > 0);
}

function allFindings(data: DemoBrief): Finding[] {
  return Object.values(data.brief.dimensions).flatMap((report) => report.findings);
}

function shorten(value: string, length = 8): string {
  return value.length <= length ? value : value.slice(0, length);
}

/* ── the artifacts ───────────────────────────────────────────────────────── */

function Findings({ findings }: { findings: readonly Finding[] }) {
  return (
    <ul className="facts">
      {findings.map((finding) => (
        <li key={`${finding.metric}-${finding.surface ?? "all"}`} className="fact">
          <span className={`fact__basis fact__basis--${finding.basis}`} aria-hidden="true" />
          <span className="fact__metric">{metricLabel(finding.metric)}</span>
          <span className="fact__value">
            {finding.delta === null
              ? formatMeasure(finding.head)
              : formatMeasure(finding.delta, { signed: true })}
          </span>
          <span className="fact__tag">{finding.basis}</span>
        </li>
      ))}
    </ul>
  );
}

function Frozen({ data }: { data: DemoBrief }) {
  const { snapshot } = data;
  const surface = data.profile.surfaces[0]?.id ?? null;
  const traffic = surface === null ? null : snapshot.context.surfaceTrafficPercentile[surface];
  const lines = [
    `id            ${snapshot.id}`,
    `captured      ${snapshot.capturedAt.slice(0, 19)}Z`,
    `records       ${snapshot.records.length}`,
    `ref           ${snapshot.ref.kind} ${snapshot.ref.id} ${snapshot.ref.base}...${shorten(snapshot.ref.head, 28)}`,
    "",
    "context",
    ...(traffic === null || traffic === undefined
      ? []
      : [`  traffic     ${surface} at p${Math.round(traffic * 100)}`]),
    ...(snapshot.context.touchedServiceMonthlySpendUsd === null
      ? []
      : [`  spend       $${snapshot.context.touchedServiceMonthlySpendUsd.toFixed(2)} a month`]),
    `  measurable  ${snapshot.context.measurableSurfaces.join(", ") || "none"}`,
    `  missing     ${snapshot.context.surfacesMissingFeatureEvents.join(", ") || "none"}`,
  ];
  return (
    <pre className="sheet-pre">
      <code>{lines.join("\n")}</code>
    </pre>
  );
}

function Rules({ data }: { data: DemoBrief }) {
  const inForce = rulesFor(data.brief.policy);
  const fired = new Map(
    [...data.decision.triggered, ...data.decision.observed, ...data.decision.waived].map(
      (evaluation) => [evaluation.ruleId, evaluation],
    ),
  );
  return (
    <ul className="rulelist">
      {inForce.map((rule) => {
        const hit = fired.get(rule.id);
        const enforcement: Enforcement = hit?.enforcement ?? rule.enforcement;
        const severity: Severity | null = hit?.severity ?? null;
        return (
          <li key={rule.id} className={`rule${hit ? " rule--fired" : ""}`}>
            <span className="rule__id">{rule.id}</span>
            <span className="rule__dim">{rule.dimension}</span>
            {severity !== null && <span className="rule__sev">{severity}</span>}
            <span className={`rule__enf rule__enf--${enforcement}`}>{enforcement}</span>
            <span className="rule__state">{hit ? "fired" : "quiet"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Record({ data }: { data: DemoBrief }) {
  const { decision } = data;
  const excerpt = {
    verdict: decision.verdict,
    confidence: decision.confidence,
    gate: decision.gate,
    outcome: decision.outcome,
    triggered: decision.triggered.map((rule) => rule.ruleId),
    digest: decision.digest,
    signature: decision.signature ?? null,
    evidenceSource: decision.evidenceSource ?? "collected",
    engine: decision.engine,
  };
  return (
    <pre className="sheet-pre">
      <code>{JSON.stringify(excerpt, null, 2)}</code>
    </pre>
  );
}

function Surfaces({ data }: { data: DemoBrief }) {
  const { brief, profile } = data;
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
    </div>
  );
}

/* ── the stages ──────────────────────────────────────────────────────────── */

function stages(data: DemoBrief): Stage[] {
  const { brief, profile, decision, snapshot, evidence } = data;
  const change = profile.cacheDirectivesChanged[0];
  const driver = evidence.estimate?.items[0];
  const findings = allFindings(data);
  const bases = countBy(
    findings.map((finding) => finding.basis),
    BASIS_ORDER,
  );
  const inForce = rulesFor(brief.policy);
  const diff: CodeLine[] =
    change === undefined
      ? []
      : [
          { kind: "del", text: `"Cache-Control": "${change.from}"` },
          {
            kind: "add",
            text: `"Cache-Control": "${change.to}"`,
            ...(driver === undefined ? {} : { cost: `+$${driver.usd.toFixed(2)}/mo` }),
          },
        ];
  const surface = profile.surfaces[0]?.id ?? "—";

  return [
    {
      id: "change",
      label: "change",
      title: "A diff becomes a profile.",
      body: "blast reads the pull request and writes down what it touches: the surfaces, the endpoints, the cache directives, the dependencies. No model, no guess.",
      metric: `#${brief.ref.id} · ${profile.filesChanged} file${profile.filesChanged === 1 ? "" : "s"}`,
      rows: [
        ["branch", shorten(brief.ref.head, 34)],
        ["surface", surface],
        ...(change === undefined
          ? []
          : [["directive", `${change.from} → ${change.to}`] as [string, string]]),
      ],
      artifact: <CodeBlock lines={diff} label="The change" />,
    },
    {
      id: "evidence",
      label: "evidence",
      title: "Sources answer, and every number carries a basis.",
      body: "Nine adapters are asked at once. A measurement says measured; a model says modeled; a source that cannot answer leaves a dimension unmeasured, never a zero.",
      metric: `${findings.length} findings from ${brief.sources.length} sources`,
      rows: bases.map(([basis, count]) => [basis, String(count)]),
      artifact: <Findings findings={findings} />,
    },
    {
      id: "snapshot",
      label: "snapshot",
      title: "Frozen and content-addressed before anything decides.",
      body: "The findings and the context a rule reads are hashed together. Replay recomputes the address before trusting it, and calls no adapter, so a vendor being down verifies nothing either way.",
      metric: `${snapshot.records.length} records · ${snapshot.id}`,
      rows: [
        ["address", snapshot.id],
        ["captured", snapshot.capturedAt.slice(0, 10)],
        ["sources", String(snapshot.sources.length)],
      ],
      artifact: <Frozen data={data} />,
    },
    {
      id: "rules",
      label: "rules",
      title: "Declared like blast.json. The model never picks.",
      body: "Every rule matches evidence by metric and dimension and compares it to a budget the team wrote down. Severity says how bad; enforcement says what it may do about it.",
      metric: `${inForce.length} in force · ${decision.triggered.length} fired`,
      rows: [
        ["in force", String(inForce.length)],
        ["fired", String(decision.triggered.length)],
        ["waived", String(decision.waived.length)],
        ["disabled", String(brief.policy.disabled.length)],
      ],
      artifact: <Rules data={data} />,
    },
    {
      id: "decision",
      label: "decision",
      title: "One record: the verdict, the rules that fired, the digest.",
      body: "The verdict is a function of exactly the triggered list. Two runs over the same change produce the same digest, which is how determinism is checked rather than claimed.",
      metric: `${brief.verdict} · exit ${exitCodeFor(decision)}`,
      rows: [
        ["verdict", brief.verdict],
        ["confidence", brief.confidence],
        ["digest", brief.digest],
      ],
      artifact: <Record data={data} />,
    },
    {
      id: "surfaces",
      label: "surfaces",
      title: "A comment, an exit code, the API, this page.",
      body: "Every surface renders the same decision object. Ask production for its headers, or reproduce the digest from a clone; if they differ, the page is wrong and you can say so with evidence.",
      metric: "same digest everywhere",
      rows: [
        ["pull request", "a comment, replaced in place"],
        ["CI", `exit ${exitCodeFor(decision)} under --fail-on ${decision.gate ?? "hold"}`],
        ["API", "x-blast-verdict, x-blast-digest"],
      ],
      artifact: <Surfaces data={data} />,
    },
  ];
}

export async function ProofRail() {
  const result = await getDemoBrief();
  if (!result.ok) return null;

  return (
    <ProofStack>
      {stages(result.value).map((stage, index) => (
        <article
          key={stage.id}
          className="proof__panel"
          data-proof-panel
          aria-labelledby={`proof-${stage.id}`}
        >
          <div className="proof__inner" data-proof-inner>
            <div className="proof__copy">
              <p className="proof__kicker">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{stage.label}</span>
              </p>
              <h3 className="proof__title" id={`proof-${stage.id}`}>
                {stage.title}
              </h3>
              <p className="proof__body">{stage.body}</p>
              <p className="proof__metric">{stage.metric}</p>
            </div>
            <div className="proof__art">{stage.artifact}</div>
            <dl className="proof__rows">
              <span className="proof__rail" data-proof-rail aria-hidden="true" />
              {stage.rows.map(([key, value]) => (
                <div key={key} className="proof__row">
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </article>
      ))}
    </ProofStack>
  );
}
