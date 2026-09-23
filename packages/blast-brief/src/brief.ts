import type {
  Assessment,
  ChangeProfile,
  Dimension,
  DimensionStatus,
  Finding,
  ImpactBrief,
  Measure,
  Policy,
  SourceStatus,
  Verdict,
} from "@blast/core";
import { briefDigest, DEFAULT_POLICY, describePolicy, DIMENSIONS, METRIC } from "@blast/core";

/**
 * Assembles and renders the brief.
 *
 * The reader is deciding whether to merge, so the verdict and the single most
 * important risk come first and everything else is available underneath. Numbers are
 * never shown without the basis that produced them.
 */

const GLYPH: Record<DimensionStatus, string> = {
  risk: "⚠",
  acceptable: "○",
  unmeasured: "◌",
};

const HEADING: Record<Dimension, string> = {
  performance: "Performance",
  cost: "Infrastructure cost",
  measurability: "Measurability",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  ship: "ship",
  "ship-with-caveats": "ship with caveats",
  hold: "hold",
};

const METRIC_LABEL: Record<string, string> = {
  [METRIC.p75Lcp]: "p75 LCP",
  [METRIC.p75LcpProjected]: "p75 LCP, projected",
  [METRIC.p75Inp]: "p75 INP",
  [METRIC.p75Ttfb]: "p75 TTFB",
  [METRIC.p95Server]: "p95 server",
  [METRIC.clientJsBytes]: "client JS",
  [METRIC.monthlyCostUsd]: "monthly spend",
  [METRIC.funnelStepConversion]: "funnel baseline",
  [METRIC.minimumDetectableEffect]: "detectable effect",
  [METRIC.historicalEffect]: "effects seen here",
  [METRIC.featureEventCoverage]: "attributable events",
};

/**
 * The opening of the HTML comment every rendered brief ends with. Matching on this
 * prefix is how `post_comment` finds the brief it posted last time.
 */
export const BRIEF_MARKER = "<!-- blast:brief";

/** The digest carried by a rendered brief, or null when the text is not one. */
export function digestOf(markdown: string): string | null {
  const match = new RegExp(`${BRIEF_MARKER} digest=([0-9a-f]{16}) -->`).exec(markdown);
  return match?.[1] ?? null;
}

export function formatMeasure(measure: Measure | null, options: { signed?: boolean } = {}): string {
  if (measure === null) return "—";
  const { value, unit } = measure;
  const sign = options.signed === true && value > 0 ? "+" : "";

  switch (unit) {
    case "ms":
      return options.signed !== true && Math.abs(value) >= 1000
        ? `${(value / 1000).toFixed(2)}s`
        : `${sign}${Math.round(value)}ms`;
    case "bytes":
      return `${sign}${(value / 1024).toFixed(0)} KB`;
    case "usd/month":
      return `${sign}$${value.toFixed(2)}/mo`;
    case "%":
      return `${sign}${value.toFixed(1)}%`;
    case "pp":
      return `${sign}${value.toFixed(2)}pp`;
    case "events":
      return `${sign}${Math.round(value)}`;
    default:
      // Unrounded floats read as noise, not precision. A new unit belongs above.
      return `${sign}${Number(value.toFixed(2))} ${unit}`.trim();
  }
}

function metricLabel(finding: Finding): string {
  const label = METRIC_LABEL[finding.metric] ?? finding.metric;
  return finding.surface === null ? label : `${label} · ${finding.surface}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export interface BriefInput {
  profile: ChangeProfile;
  assessment: Assessment;
  findings: readonly Finding[];
  /** What to watch once live. Required for any dimension that is not acceptable. */
  watchAfterShip: Partial<Record<Dimension, readonly string[]>>;
  /** Two or three sentences naming the top risk, or its absence. Written by the agent. */
  headline: string;
  sources: readonly SourceStatus[];
  /** The budgets the assessment applied. Defaults when the repository set none. */
  policy?: Policy;
  generatedAt?: string;
}

export function buildBrief(input: BriefInput): ImpactBrief {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const assessment = input.assessment.dimensions[dimension];
      return [
        dimension,
        {
          status: assessment.status,
          confidence: assessment.confidence,
          rationale: assessment.rationale,
          findings: input.findings.filter((finding) => finding.dimension === dimension),
          watchAfterShip: [...(input.watchAfterShip[dimension] ?? [])],
        },
      ];
    }),
  ) as ImpactBrief["dimensions"];

  const policy = input.policy ?? DEFAULT_POLICY;

  return {
    ref: input.profile.ref,
    intent: input.profile.intent,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    verdict: input.assessment.verdict,
    confidence: input.assessment.confidence,
    headline: input.headline,
    dimensions,
    assumptions: unique(input.findings.flatMap((finding) => finding.assumptions)),
    sources: [...input.sources],
    policy,
    digest: briefDigest({
      profile: input.profile,
      findings: input.findings,
      assessment: input.assessment,
      policy,
    }),
  };
}

function renderFindingsTable(findings: readonly Finding[]): string[] {
  if (findings.length === 0) return [];
  return [
    "| metric | base | head | delta | basis |",
    "| --- | --- | --- | --- | --- |",
    ...findings.map((finding) =>
      [
        "",
        metricLabel(finding),
        formatMeasure(finding.base),
        formatMeasure(finding.head),
        formatMeasure(finding.delta, { signed: true }),
        finding.basis,
        "",
      ]
        .join(" | ")
        .trim(),
    ),
  ];
}

export function renderBrief(brief: ImpactBrief): string {
  const title = brief.ref.kind === "pr" ? `#${brief.ref.id}` : brief.ref.id;
  const lines: string[] = [
    `# Impact brief — ${title} · ${brief.intent}`,
    "",
    `**Verdict: ${VERDICT_LABEL[brief.verdict]}** · confidence: ${brief.confidence}`,
    "",
    brief.headline,
    "",
  ];

  for (const dimension of DIMENSIONS) {
    const report = brief.dimensions[dimension];
    lines.push(`## ${HEADING[dimension]}  ${GLYPH[report.status]}`, "");
    lines.push(...renderFindingsTable(report.findings));
    if (report.findings.length > 0) lines.push("");
    lines.push(report.rationale, "");

    if (report.watchAfterShip.length > 0) {
      lines.push(`Watch after ship: ${report.watchAfterShip.join(", ")}.`, "");
    }
  }

  if (brief.assumptions.length > 0) {
    lines.push("## Assumptions", "");
    brief.assumptions.forEach((assumption, index) => {
      lines.push(`${index + 1}. ${assumption}`);
    });
    lines.push("");
  }

  lines.push(...renderBudgets(brief));

  /**
   * How long a source took is deliberately absent here, though the brief carries it.
   * This markdown is posted to a pull request, and it has to be byte-identical across
   * runs of an unchanged change — a comment that edits itself on every re-run is noise,
   * and a wall-clock reading would guarantee one. Latency belongs where it is acted on:
   * the API response and the page.
   */
  lines.push("## Sources", "", "| source | freshness | status |", "| --- | --- | --- |");
  for (const source of brief.sources) {
    lines.push(`| ${source.displayName} | ${source.freshness ?? "—"} | ${source.state} |`);
  }
  lines.push("");

  /**
   * The digest is the last line because it is the one a reader quotes rather than
   * reads. Two briefs carrying it can be compared without re-running anything, which is
   * what makes the determinism above a claim someone can check.
   */
  lines.push(`\`${brief.digest}\` · same digest, same assessment.`, "");

  /**
   * An invisible marker, so a brief already on a pull request can be found and updated
   * rather than posted beneath itself. A reviewer scrolling a thread should see one
   * brief for the current head, not one per push with no way to tell which verdict is
   * live. The digest rides along so the poster can tell a re-run from a real change
   * without re-deriving anything.
   */
  lines.push(`${BRIEF_MARKER} digest=${brief.digest} -->`, "");

  return lines.join("\n");
}

/**
 * The budgets the verdict was measured against.
 *
 * A threshold a reader cannot see is indistinguishable from one the model invented, and
 * this tool's whole claim is that the numbers are not the model's. Only overridden
 * budgets are listed when a repository set any: the defaults are documented, and
 * reprinting all eight on every brief buries the two that were changed.
 */
function renderBudgets(brief: ImpactBrief): string[] {
  const { policy } = brief;
  if (policy.origin === "defaults") {
    return ["## Budgets", "", "Default budgets. No `blast.json` set any.", ""];
  }

  const overridden = describePolicy(policy).filter((budget) => budget.overridden);
  return [
    "## Budgets",
    "",
    `From \`${policy.path ?? "blast.json"}\`, overriding ${overridden.length} default${overridden.length === 1 ? "" : "s"}:`,
    "",
    ...overridden.map((budget) => `- ${budget.label}: ${budget.value}`),
    "",
  ];
}
