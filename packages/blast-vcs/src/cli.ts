#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describeIngestAdapters, ingestWith, loadFixtureChangeProfile } from "@blast/adapters";
import {
  FileDecisionStore,
  FileReconciliationStore,
  decisionLogPath,
  loadPolicy,
  produceBrief,
  reconciliationLogPath,
} from "@blast/brief";
import type {
  ChangeProfile,
  Decision,
  EvidenceRecord,
  EvidenceSnapshot,
  Policy,
  SigningKey,
  Verdict,
} from "@blast/core";
import {
  DEFAULT_POLICY,
  EXIT_BLOCKED,
  EXIT_OK,
  EXIT_UNAVAILABLE,
  MINIMUM_RECONCILIATIONS,
  evidenceRecordSchema,
  readSnapshot,
  reconciliationSchema,
  signingKeysFrom,
  summarize,
  verifyDecision,
} from "@blast/core";
import { backfill, renderBackfill } from "./backfill.js";
import { readChange } from "./change.js";
import { postBrief } from "./comment.js";

/**
 * `blast` — the decision, without an agent turn.
 *
 * Everything that decides is deterministic code: the evidence, the budgets, the rules, the
 * verdict, and the remediations. None of it needs a model, which means none of it needs to
 * wait for someone to mention `@blast` on a thread. This is the command a pipeline runs on
 * every pull request, and it is what turns the tool from something you can ask into a check
 * that has already run by the time you look.
 *
 * Three commands, one engine underneath all of them:
 *
 *   brief    the markdown a human reads, and optionally posts to the thread
 *   decide   the same decision as JSON, for a job that is going to act on it
 *   audit    what the log says across every decision recorded so far
 *
 * `decide` is the one that makes this integrable. It accepts evidence the pipeline already
 * has — an Infracost breakdown, a Lighthouse result, records a company's own service
 * measured — normalizes it through the ingest adapters, and prints a decision object with
 * every rule that fired and the evidence that fired it. A platform team wiring blast in
 * does not have to parse a comment to find out what happened.
 *
 * Exit codes are part of the contract, not a detail:
 *   0  a decision was produced, and it cleared whatever `--fail-on` allows
 *   1  the verdict did not clear `--fail-on`
 *   2  no decision could be produced at all
 *
 * The distinction matters to the job running this. A held change and a broken tool both
 * stop a pipeline, and treating them the same teaches everyone to ignore the failure.
 */

const USAGE = `blast — a pre-ship impact decision for a change

usage
  blast brief  <pr-number|branch|fixture> [options]
  blast decide <pr-number|branch|fixture> [options]
  blast audit  [options]
  blast verify <decision.json>
  blast backfill [options]
  blast reconcile <decision-id> --observed <usd> --from <date> --to <date> [options]

brief and decide
  --intent <text>       what the change is for, in user-facing terms (required)
  --fail-on <verdict>   exit 1 when the verdict is this or worse: hold | ship-with-caveats
  --policy <path>       a blast.json to apply, instead of searching upwards
  --repo <owner/name>   the repository, recorded on the decision
  --org <name>          the organization, recorded on the decision
  --evidence <path>     JSON file of evidence records to contribute, or - for stdin
  --ingest <id>=<path>  raw output from a tool to normalize: infracost=cost.json
  --as-of <YYYY-MM-DD>  the day exception expiry is judged against (default: today)
  --log <path>          where to append the decision (default: .blast/decisions.jsonl)
  --no-log              do not record this decision
  --snapshot <path>     replay a frozen snapshot instead of collecting evidence
  --write-snapshot <p>  write the evidence this decision was made from to a file
  --sign <key-id>       sign the decision with a key from BLAST_SIGNING_KEYS

brief only
  --post                post the brief to the pull request, or update the one there
  --format <fmt>        markdown (default) | json

audit
  --repo <owner/name>   only decisions about this repository
  --rule <rule-id>      only decisions where this rule fired or was waived
  --since <iso>         only decisions made at or after this instant
  --summary             the aggregate rather than the rows (default)
  --json                machine-readable output
  --log <path>          which log to read

backfill
  Assesses the current policy against changes that already merged, and reports what it
  would have held. Every one of them shipped, so read the rates rather than the counts:
  a rule firing on most of a repository's history is miscalibrated, not strict.

  --limit <n>           how many changes back to read (default 50)
  --branch <name>       the branch to walk (default: the checked-out one)
  --policy <path>       a blast.json to assess, instead of searching upwards
  --json                machine-readable output

reconcile
  Records what a change actually cost, against what the decision predicted. Run it once the
  bill for the change has arrived. 'blast audit' then reports the model's measured error,
  and a brief carries it as a caveat on every estimate it makes.

  --observed <usd>      the monthly delta that actually appeared on the bill (required)
  --from <YYYY-MM-DD>   start of the billing window observed (required)
  --to <YYYY-MM-DD>     end of the billing window observed (required)
  --source <text>       where the figure came from: an invoice, a cost explorer
  --note <text>         why the two differ, for whoever reads this later
  --log <path>          the decision log to look the prediction up in

verify
  Reads a decision and checks it against BLAST_SIGNING_KEYS. Exit 0 when the signature
  holds, 1 when it does not, 2 when there is nothing to check it with.

exit codes
  0  decision produced and the verdict cleared --fail-on
  1  the verdict did not clear --fail-on
  2  the decision could not be produced
`;

/** Worst first, so `--fail-on ship-with-caveats` also fails a hold. */
const SEVERITY: Record<Verdict, number> = {
  hold: 2,
  "ship-with-caveats": 1,
  ship: 0,
};

type Command = "brief" | "decide" | "audit" | "verify" | "backfill" | "reconcile";

interface Options {
  command: Command;
  ref: string;
  intent: string;
  post: boolean;
  failOn: Verdict | null;
  format: "markdown" | "json";
  policy: string | null;
  repo: string | null;
  org: string | null;
  evidence: string | null;
  ingest: { adapter: string; path: string }[];
  asOf: string | null;
  log: string | null;
  record: boolean;
  rule: string | null;
  since: string | null;
  json: boolean;
  snapshot: string | null;
  writeSnapshot: string | null;
  sign: string | null;
  limit: number;
  branch: string | null;
  observed: number | null;
  from: string | null;
  to: string | null;
  source: string | null;
  note: string | null;
}

function defaults(command: Command, ref: string): Options {
  return {
    command,
    ref,
    intent: "",
    post: false,
    failOn: null,
    format: "markdown",
    policy: null,
    repo: null,
    org: null,
    evidence: null,
    ingest: [],
    asOf: null,
    log: null,
    record: true,
    rule: null,
    since: null,
    json: false,
    snapshot: null,
    writeSnapshot: null,
    sign: null,
    limit: 50,
    branch: null,
    observed: null,
    from: null,
    to: null,
    source: null,
    note: null,
  };
}

function parseArgs(argv: readonly string[]): Options | { error: string } {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { error: USAGE };
  if (
    command !== "brief" &&
    command !== "decide" &&
    command !== "audit" &&
    command !== "verify" &&
    command !== "backfill" &&
    command !== "reconcile"
  ) {
    return { error: `Unknown command ${command}.\n\n${USAGE}` };
  }

  if (command === "verify") {
    const path = rest[0];
    if (path === undefined || path.startsWith("-")) {
      return { error: `A decision file is required.\n\n${USAGE}` };
    }
    return { ...defaults(command, path), intent: "n/a" };
  }

  let ref = "";
  let start = 0;

  if (command !== "audit" && command !== "backfill") {
    const candidate = rest[0];
    if (candidate === undefined || candidate.startsWith("-")) {
      return { error: `A pull request number, a branch, or 'fixture' is required.\n\n${USAGE}` };
    }
    ref = candidate;
    start = 1;
  }

  const options = defaults(command, ref);

  for (let index = start; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];

    switch (flag) {
      case "--post":
        options.post = true;
        break;
      case "--no-log":
        options.record = false;
        break;
      case "--summary":
        break;
      case "--json":
        options.json = true;
        break;
      case "--intent":
        if (value === undefined) return { error: "--intent needs a value." };
        options.intent = value;
        index += 1;
        break;
      case "--fail-on": {
        if (value === undefined) return { error: "--fail-on needs a value." };
        if (value !== "hold" && value !== "ship-with-caveats") {
          return { error: `--fail-on takes hold or ship-with-caveats, not ${value}.` };
        }
        options.failOn = value;
        index += 1;
        break;
      }
      case "--format":
        if (value !== "markdown" && value !== "json") {
          return { error: "--format takes markdown or json." };
        }
        options.format = value;
        index += 1;
        break;
      case "--policy":
        if (value === undefined) return { error: "--policy needs a path." };
        options.policy = value;
        index += 1;
        break;
      case "--repo":
        if (value === undefined) return { error: "--repo needs an owner/name." };
        options.repo = value;
        index += 1;
        break;
      case "--org":
        if (value === undefined) return { error: "--org needs a name." };
        options.org = value;
        index += 1;
        break;
      case "--evidence":
        if (value === undefined) return { error: "--evidence needs a path, or - for stdin." };
        options.evidence = value;
        index += 1;
        break;
      case "--ingest": {
        if (value === undefined) {
          return { error: "--ingest takes <adapter>=<path>, for example infracost=cost.json." };
        }
        const split = value.indexOf("=");
        if (split <= 0 || split === value.length - 1) {
          const known = describeIngestAdapters()
            .map((entry) => entry.id)
            .join(", ");
          return {
            error: `--ingest takes <adapter>=<path>. Registered adapters: ${known}.`,
          };
        }
        options.ingest.push({
          adapter: value.slice(0, split),
          path: value.slice(split + 1),
        });
        index += 1;
        break;
      }
      case "--as-of":
        if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { error: "--as-of takes a date, as YYYY-MM-DD." };
        }
        options.asOf = value;
        index += 1;
        break;
      case "--log":
        if (value === undefined) return { error: "--log needs a path." };
        options.log = value;
        index += 1;
        break;
      case "--rule":
        if (value === undefined) return { error: "--rule needs a rule id." };
        options.rule = value;
        index += 1;
        break;
      case "--since":
        if (value === undefined) return { error: "--since needs an ISO instant." };
        options.since = value;
        index += 1;
        break;
      case "--limit": {
        const parsedLimit = Number(value);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
          return { error: "--limit takes a whole number between 1 and 1000." };
        }
        options.limit = parsedLimit;
        index += 1;
        break;
      }
      case "--branch":
        if (value === undefined) return { error: "--branch needs a name." };
        options.branch = value;
        index += 1;
        break;
      case "--observed": {
        const usd = Number(value);
        if (!Number.isFinite(usd)) return { error: "--observed takes a dollar amount." };
        options.observed = usd;
        index += 1;
        break;
      }
      case "--from":
        if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { error: "--from takes a date, as YYYY-MM-DD." };
        }
        options.from = value;
        index += 1;
        break;
      case "--to":
        if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { error: "--to takes a date, as YYYY-MM-DD." };
        }
        options.to = value;
        index += 1;
        break;
      case "--source":
        if (value === undefined) return { error: "--source needs a description." };
        options.source = value;
        index += 1;
        break;
      case "--note":
        if (value === undefined) return { error: "--note needs text." };
        options.note = value;
        index += 1;
        break;
      case "--snapshot":
        if (value === undefined) return { error: "--snapshot needs a path, or - for stdin." };
        options.snapshot = value;
        index += 1;
        break;
      case "--write-snapshot":
        if (value === undefined) return { error: "--write-snapshot needs a path." };
        options.writeSnapshot = value;
        index += 1;
        break;
      case "--sign":
        if (value === undefined) return { error: "--sign needs a key id from BLAST_SIGNING_KEYS." };
        options.sign = value;
        index += 1;
        break;
      case "--help":
      case "-h":
        return { error: USAGE };
      default:
        return { error: `Unknown option ${flag}.\n\n${USAGE}` };
    }
  }

  if (options.command === "reconcile") {
    if (options.observed === null) return { error: "--observed is required.\n\n" + USAGE };
    if (options.from === null || options.to === null) {
      return { error: "--from and --to are required: an observation needs a window.\n\n" + USAGE };
    }
    return options;
  }

  if (
    options.command !== "audit" &&
    options.command !== "verify" &&
    options.command !== "backfill" &&
    options.intent === ""
  ) {
    /**
     * Refused rather than defaulted. A diff says what moved and never what it is for, and
     * the measurability dimension is the one that most needs the difference — a brief
     * written against an invented intent reads exactly like one written against a real one.
     */
    return { error: "--intent is required: one line on what the change is for.\n\n" + USAGE };
  }

  return options;
}

async function readInput(path: string): Promise<string> {
  if (path !== "-") return readFile(path, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Evidence the pipeline brought, validated before it can influence anything.
 *
 * A record that fails the schema fails the run rather than being dropped. A cost gate that
 * silently contributed nothing because a field was misspelled is the exact failure this is
 * supposed to prevent, and it looks identical to a clean run from the outside.
 */
async function contributedEvidence(
  options: Options,
  surfaces: readonly string[],
): Promise<{ records: EvidenceRecord[]; notes: string[] } | { error: string }> {
  const records: EvidenceRecord[] = [];
  const notes: string[] = [];

  if (options.evidence !== null) {
    let document: unknown;
    try {
      document = JSON.parse(await readInput(options.evidence));
    } catch (error) {
      return {
        error: `--evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const list = Array.isArray(document) ? document : [document];
    for (const [index, entry] of list.entries()) {
      const parsed = evidenceRecordSchema.safeParse(entry);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
          error: `--evidence record ${index} is invalid: ${issue?.message ?? "unknown"} at ${issue?.path.join(".") || "the record"}`,
        };
      }
      records.push(parsed.data);
    }
    notes.push(`Contributed ${records.length} evidence record${records.length === 1 ? "" : "s"}.`);
  }

  for (const entry of options.ingest) {
    let payload: unknown;
    try {
      payload = JSON.parse(await readInput(entry.path));
    } catch (error) {
      return {
        error: `--ingest ${entry.adapter}: ${entry.path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const result = ingestWith(entry.adapter, payload, { surfaces });
    if (!result.ok) {
      // A clean run with nothing to say is a note. A broken payload is a failure.
      if (result.reason === "no-data") {
        notes.push(`${entry.adapter}: ${result.detail}`);
        continue;
      }
      return { error: `--ingest ${entry.adapter}: ${result.detail}` };
    }

    records.push(...result.value);
    notes.push(
      `${entry.adapter}: ${result.value.length} record${result.value.length === 1 ? "" : "s"} from ${entry.path}.`,
    );
  }

  return { records, notes };
}

/**
 * Checks a decision against the configured signing keys.
 *
 * This is the command an audit or a release process runs. It exits 1 on a signature that does
 * not hold and 2 when there is nothing to check it with, because "this decision was forged" and
 * "I have no keys" are different facts and a process that treated them alike would pass on a
 * misconfigured runner.
 */
async function runVerify(options: Options): Promise<number> {
  let document: unknown;
  try {
    document = JSON.parse(await readInput(options.ref));
  } catch (error) {
    process.stderr.write(
      `blast: ${options.ref} could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const keys = signingKeysFrom(process.env.BLAST_SIGNING_KEYS);
  if (!keys.ok) {
    process.stderr.write(`blast: ${keys.detail}\n`);
    return EXIT_UNAVAILABLE;
  }
  if (keys.value.length === 0) {
    process.stderr.write("blast: no signing keys configured. Set BLAST_SIGNING_KEYS to verify.\n");
    return EXIT_UNAVAILABLE;
  }

  const decision = document as Decision;
  if (typeof decision?.digest !== "string") {
    process.stderr.write("blast: that file is not a decision.\n");
    return EXIT_UNAVAILABLE;
  }

  const verified = await verifyDecision(decision, keys.value);
  if (!verified.ok) {
    process.stderr.write(`blast: ${verified.detail}\n`);
    // An unsigned decision is a missing record rather than a forged one.
    return verified.reason === "no-data" ? EXIT_UNAVAILABLE : EXIT_BLOCKED;
  }

  process.stdout.write(
    `verified: ${decision.verdict} on ${decision.subject.repo ?? decision.subject.ref.id}, signed ${verified.value.signedAt} by ${verified.value.keyId}, digest ${decision.digest}\n`,
  );
  return EXIT_OK;
}

/**
 * Assesses the current policy against history.
 *
 * Nothing here is recorded in the decision log. A backfill assesses changes against a policy
 * that did not exist when they merged, and putting those in the audit trail would fill it with
 * decisions that were never made about changes that were never gated.
 */
async function runBackfill(options: Options): Promise<number> {
  let policy: Policy | undefined;
  if (options.policy !== null) {
    const loaded = await loadPolicy({ path: options.policy });
    if (!loaded.ok) {
      process.stderr.write(`blast: ${loaded.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    policy = loaded.value;
  }

  const interactive = process.stderr.isTTY === true;
  const report = await backfill({
    limit: options.limit,
    ...(options.branch === null ? {} : { branch: options.branch }),
    ...(policy === undefined ? {} : { policy }),
    ...(options.asOf === null ? {} : { asOf: options.asOf }),
    onProgress: (done, total) => {
      // Only when somebody is watching: a progress line in a CI log is noise.
      if (interactive) process.stderr.write(`\rassessing ${done}/${total}…`);
    },
  });
  if (interactive) process.stderr.write("\r\u001b[K");

  if ("error" in report) {
    process.stderr.write(`blast: ${report.error}\n`);
    return EXIT_UNAVAILABLE;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT_OK;
  }

  process.stdout.write(`${renderBackfill(report).join("\n")}\n`);
  return EXIT_OK;
}

/**
 * Records what a change actually cost against what the decision predicted.
 *
 * The prediction is read from the decision log rather than taken from the caller. A
 * reconciliation whose "predicted" number came from whoever was typing would measure nothing —
 * the point is to compare the model against reality, and the model's side of that has to come
 * from the record it wrote at the time.
 */
async function runReconcile(options: Options): Promise<number> {
  const store = new FileDecisionStore({ path: decisionLogPath(options.log ?? undefined) });

  let found;
  try {
    found = await store.get(options.ref);
  } catch (error) {
    process.stderr.write(
      `blast: the decision log could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  if (found === null) {
    process.stderr.write(
      `blast: no decision ${options.ref} in the log. Reconcile against a decision that was recorded, so the prediction comes from the record rather than from memory.\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const predicted = found.decision.impact.monthlyCostDeltaUsd;
  if (predicted === null) {
    process.stderr.write(
      `blast: decision ${options.ref} carried no monthly cost estimate, so there is nothing to compare a bill to.\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const record = reconciliationSchema.safeParse({
    schemaVersion: 1,
    decisionId: found.decision.id,
    repo: found.decision.subject.repo,
    predictedMonthlyCostUsd: predicted,
    observedMonthlyCostUsd: options.observed,
    observedFrom: options.from,
    observedTo: options.to,
    observedFrom_source: options.source ?? "stated by the caller",
    reconciledAt: new Date().toISOString(),
    note: options.note,
  });
  if (!record.success) {
    const issue = record.error.issues[0];
    process.stderr.write(
      `blast: ${issue?.message ?? "invalid reconciliation"} at ${issue?.path.join(".") || "the record"}.\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const reconciliations = new FileReconciliationStore({
    path: reconciliationLogPath(),
  });
  try {
    await reconciliations.append(record.data);
  } catch (error) {
    process.stderr.write(
      `blast: the reconciliation could not be written: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const accuracy = await reconciliations.accuracy();
  const observed = record.data.observedMonthlyCostUsd;
  const direction = predicted < observed ? "under" : predicted > observed ? "over" : "exactly";

  process.stdout.write(
    `recorded: predicted $${predicted.toFixed(2)}, billed $${observed.toFixed(2)} — the model read ${direction}.\n`,
  );
  if (accuracy.medianAbsoluteErrorPct !== null) {
    process.stdout.write(
      `model error across ${accuracy.records} reconciled change${accuracy.records === 1 ? "" : "s"}: ${accuracy.medianAbsoluteErrorPct}% median absolute\n`,
    );
  }
  if (accuracy.records < MINIMUM_RECONCILIATIONS) {
    process.stdout.write(
      `not yet quoted in briefs: ${MINIMUM_RECONCILIATIONS} reconciled changes are needed before a median means anything.\n`,
    );
  }

  return EXIT_OK;
}

async function runAudit(options: Options): Promise<number> {
  const store = new FileDecisionStore({ path: decisionLogPath(options.log ?? undefined) });

  let records;
  try {
    records = await store.list({
      ...(options.repo === null ? {} : { repo: options.repo }),
      ...(options.rule === null ? {} : { ruleId: options.rule }),
      ...(options.since === null ? {} : { since: options.since }),
      limit: 1000,
    });
  } catch (error) {
    process.stderr.write(
      `blast: the decision log could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_UNAVAILABLE;
  }

  const summary = summarize(records);

  /**
   * The model's measured error belongs next to the totals it qualifies. A report that stated
   * "$4,120 of modeled monthly spend on held changes" without saying how well this model has
   * predicted bills before is asking to be read as a savings figure.
   */
  const accuracy = await new FileReconciliationStore({ path: reconciliationLogPath() }).accuracy(
    options.repo === null ? {} : { repo: options.repo },
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...summary, costAccuracy: accuracy }, null, 2)}\n`);
    return EXIT_OK;
  }

  if (summary.decisions === 0) {
    process.stdout.write("No decisions recorded yet.\n");
    return EXIT_OK;
  }

  const lines: string[] = [
    `${summary.decisions} decision${summary.decisions === 1 ? "" : "s"}: ${summary.held} held, ${summary.blocked} blocked by a gate`,
    `verdicts: ${summary.byVerdict.ship} ship, ${summary.byVerdict["ship-with-caveats"]} with caveats, ${summary.byVerdict.hold} hold`,
    /**
     * Named as modeled, every time it is printed. It is the sum of an estimate over changes
     * blast said no to, which is worth knowing and is not money in the bank.
     */
    `monthly spend on held changes: $${summary.heldMonthlyCostUsd.toFixed(2)} (modeled, not billed)`,
  ];

  /**
   * A gate installed and not enabled is the most common way this stops working, and it is
   * invisible unless something says it out loud.
   */
  if (summary.held > 0 && summary.blocked === 0) {
    lines.push(
      `note: ${summary.held} change${summary.held === 1 ? " was" : "s were"} held and none were blocked. No caller is passing --fail-on.`,
    );
  }

  if (summary.rules.length > 0) {
    lines.push("", "rules");
    for (const rule of summary.rules) {
      const rate = rule.waiveRate === null ? "—" : `${Math.round(rule.waiveRate * 100)}%`;
      lines.push(
        `  ${rule.ruleId}  fired ${rule.fired}  waived ${rule.waived}  silent ${rule.observed}  waive rate ${rate}${rule.owner === null ? "" : `  owner ${rule.owner}`}`,
      );
    }
  }

  if (accuracy.records > 0) {
    lines.push(
      "",
      "cost model, against the bill",
      `  reconciled changes  ${accuracy.records}`,
      `  median error        ${accuracy.medianAbsoluteErrorPct === null ? "—" : `${accuracy.medianAbsoluteErrorPct}%`}`,
      `  predicted / billed  $${accuracy.totalPredictedUsd.toFixed(2)} / $${accuracy.totalObservedUsd.toFixed(2)}`,
    );
    if (accuracy.worst !== null) {
      lines.push(
        `  worst miss          ${accuracy.worst.errorPct}% on ${accuracy.worst.decisionId}`,
      );
    }
    if (accuracy.records < MINIMUM_RECONCILIATIONS) {
      lines.push(
        `  (not quoted in briefs yet: ${MINIMUM_RECONCILIATIONS} reconciled changes are needed first)`,
      );
    }
  } else {
    lines.push(
      "",
      "No change has been reconciled against a bill, so this model's error is unknown.",
      "Run `blast reconcile <decision-id> --observed <usd> --from … --to …` once a bill arrives.",
    );
  }

  if (summary.lapsedExceptions.length > 0) {
    lines.push("", "lapsed exceptions still being relied on");
    for (const entry of summary.lapsedExceptions) {
      lines.push(`  ${entry.ruleId}  ${entry.count}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return EXIT_OK;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return parsed.error === USAGE ? EXIT_OK : EXIT_UNAVAILABLE;
  }

  if (parsed.command === "audit") return runAudit(parsed);
  if (parsed.command === "verify") return runVerify(parsed);
  if (parsed.command === "backfill") return runBackfill(parsed);
  if (parsed.command === "reconcile") return runReconcile(parsed);

  let profile: ChangeProfile;
  let notes: string[];

  if (parsed.ref === "fixture") {
    const fixture = loadFixtureChangeProfile();
    if (!fixture.ok) {
      process.stderr.write(`blast: ${fixture.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    profile = fixture.value;
    notes = ["Read from the checked-in sample pull request."];
  } else {
    const read = await readChange({ ref: parsed.ref, intent: parsed.intent });
    if (!read.ok) {
      process.stderr.write(`blast: ${read.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    profile = read.value.profile;
    notes = read.value.notes;
  }

  /**
   * A named policy file that cannot be read stops the run here rather than falling back. A
   * pipeline that asked for its own budgets and silently got the defaults would gate merges
   * on ceilings nobody chose, and every run would look ordinary.
   */
  let policy: Policy | undefined;
  if (parsed.policy !== null) {
    const loaded = await loadPolicy({ path: parsed.policy });
    if (!loaded.ok) {
      process.stderr.write(`blast: ${loaded.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    policy = loaded.value;
  } else if (parsed.ref === "fixture") {
    /**
     * The sample pull request is a fictional storefront's, and its budgets are the defaults.
     *
     * Without this, running `blast brief fixture` inside a repository that has a `blast.json`
     * assesses somebody else's change against that repository's budgets — which is the same
     * category error `/api/brief` refuses by never reading a policy beside the server, and the
     * one the demo page had to be pinned against. Asked for by name with `--policy`, a file
     * still applies: that is a caller saying what they mean.
     */
    policy = DEFAULT_POLICY;
    notes.push("Assessed against the default budgets: the sample change is not this repository's.");
  }

  const surfaces = profile.surfaces.map((surface) => surface.id);
  const contributed = await contributedEvidence(parsed, surfaces);
  if ("error" in contributed) {
    process.stderr.write(`blast: ${contributed.error}\n`);
    return EXIT_UNAVAILABLE;
  }
  notes.push(...contributed.notes);

  /**
   * A snapshot is verified before it can decide anything. `readSnapshot` recomputes the content
   * address, so a file somebody edited after it was taken is refused rather than replayed —
   * without that, `--snapshot` would be a way to hand the engine any numbers you like and get a
   * decision that looked rigorous.
   */
  let snapshot: EvidenceSnapshot | undefined;
  if (parsed.snapshot !== null) {
    let document: unknown;
    try {
      document = JSON.parse(await readInput(parsed.snapshot));
    } catch (error) {
      process.stderr.write(
        `blast: --snapshot could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return EXIT_UNAVAILABLE;
    }

    const read = readSnapshot(document);
    if (!read.ok) {
      process.stderr.write(`blast: ${read.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    snapshot = read.value;
    notes.push(
      `Replayed from a snapshot taken ${read.value.capturedAt} (${read.value.records.length} records, ${read.value.id}). No source was called.`,
    );
  }

  let signingKey: SigningKey | undefined;
  if (parsed.sign !== null) {
    const keys = signingKeysFrom(process.env.BLAST_SIGNING_KEYS);
    if (!keys.ok) {
      process.stderr.write(`blast: ${keys.detail}\n`);
      return EXIT_UNAVAILABLE;
    }
    const found = keys.value.find((key) => key.id === parsed.sign);
    if (found === undefined) {
      const known = keys.value.map((key) => key.id).join(", ") || "none";
      process.stderr.write(
        `blast: no signing key named ${parsed.sign}. Configured in BLAST_SIGNING_KEYS: ${known}.\n`,
      );
      return EXIT_UNAVAILABLE;
    }
    signingKey = found;
  }

  const produced = await produceBrief({
    profile: { ...profile, intent: parsed.intent },
    /**
     * No model ran, so nothing here writes a narrative. Saying that plainly is better than a
     * generated sentence that reads like judgement and is not: the dimension rationales
     * below it are the rules' own words, and they are the honest version.
     */
    headline:
      "Produced without a model, so this line is not an assessment. The verdict, every number, and the remediations below are code over the evidence; the dimension rationales say which rule decided what.",
    evidence: contributed.records,
    gate: parsed.failOn,
    repo: parsed.repo,
    org: parsed.org,
    ...(policy === undefined ? {} : { policy }),
    ...(parsed.asOf === null ? {} : { asOf: parsed.asOf }),
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(signingKey === undefined ? {} : { signingKey }),
    /**
     * The model's measured error, so a brief states how much a reader should act on its
     * estimate. Absent until enough changes have been reconciled, which is the honest state of
     * a model whose predictions have never been checked.
     */
    costAccuracy: await new FileReconciliationStore({ path: reconciliationLogPath() }).accuracy(
      parsed.repo === null ? {} : { repo: parsed.repo },
    ),
  });

  if (!produced.ok) {
    process.stderr.write(`blast: ${produced.detail}\n`);
    return EXIT_UNAVAILABLE;
  }

  const { brief, markdown, decision, snapshot: captured } = produced.value;

  /**
   * Written before anything else can fail. The snapshot is what makes a decision reproducible,
   * and a run that produced one and then fell over while posting should still leave it behind.
   */
  if (parsed.writeSnapshot !== null) {
    try {
      await mkdir(dirname(parsed.writeSnapshot), { recursive: true });
      await writeFile(parsed.writeSnapshot, `${JSON.stringify(captured, null, 2)}\n`, "utf8");
      notes.push(`Snapshot ${captured.id} written to ${parsed.writeSnapshot}.`);
    } catch (error) {
      process.stderr.write(
        `blast: the snapshot could not be written: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return EXIT_UNAVAILABLE;
    }
  }

  if (parsed.command === "decide") {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else if (parsed.format === "json") {
    process.stdout.write(`${JSON.stringify({ brief, markdown, decision, notes }, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
    // Notes go to stderr so `blast brief … > brief.md` is the brief and nothing else.
    for (const note of notes) process.stderr.write(`note: ${note}\n`);
  }

  /**
   * Recorded before the gate is applied, and before posting. The log is about what was
   * decided, not about what the pipeline then did with it — a blocked change that nobody
   * ever saw is exactly the kind of thing an audit needs to contain.
   */
  if (parsed.record) {
    try {
      await new FileDecisionStore({ path: decisionLogPath(parsed.log ?? undefined) }).append({
        decision,
        recordedAt: new Date().toISOString(),
        actor: parsed.repo === null ? "cli" : `cli:${parsed.repo}`,
      });
    } catch (error) {
      // A log that cannot be written must not discard a decision that was already made.
      process.stderr.write(
        `blast: the decision was produced but not recorded. ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  if (parsed.post) {
    if (brief.ref.kind !== "pr") {
      process.stderr.write("blast: --post needs a pull request number, not a branch.\n");
      return EXIT_UNAVAILABLE;
    }
    const outcome = await postBrief({ pullRequest: brief.ref.id, markdown });
    if (!outcome.ok) {
      process.stderr.write(
        `blast: the brief was produced but not posted. ${outcome.failure.detail}\n`,
      );
      return EXIT_UNAVAILABLE;
    }
    process.stderr.write(`blast: ${outcome.action} (${brief.digest}).\n`);
  }

  if (parsed.failOn !== null && SEVERITY[brief.verdict] >= SEVERITY[parsed.failOn]) {
    process.stderr.write(
      `blast: verdict is ${brief.verdict}, which does not clear --fail-on ${parsed.failOn}.\n`,
    );
    for (const evaluation of decision.triggered) {
      process.stderr.write(`blast:   ${evaluation.ruleId}: ${evaluation.message}\n`);
    }
    return EXIT_BLOCKED;
  }

  return EXIT_OK;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Nothing should reach here; if it does, say so rather than exiting 1 and looking like
    // a held verdict.
    process.stderr.write(`blast: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = EXIT_UNAVAILABLE;
  });
