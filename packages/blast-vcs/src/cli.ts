#!/usr/bin/env node
import { loadFixtureChangeProfile } from "@blast/adapters";
import { loadPolicy, produceBrief } from "@blast/brief";
import type { ChangeProfile, Verdict } from "@blast/core";
import { readChange } from "./change.js";
import { postBrief } from "./comment.js";

/**
 * `blast` — the brief, without an agent turn.
 *
 * Everything that decides is deterministic code: the evidence, the budgets, the verdict,
 * and the remediations. None of it needs a model, which means none of it needs to wait
 * for someone to mention `@blast` on a thread. This is the command a pipeline runs on
 * every pull request, and it is what turns the tool from something you can ask into a
 * check that has already run by the time you look.
 *
 * The one thing a model contributes is the narrative — which risk leads and how to say
 * it. Run here, the brief carries the rules' own rationale instead, which is less
 * readable and exactly as true. A team wanting the narrative mentions the agent; the
 * numbers and the verdict are identical either way, and the digest proves it.
 *
 * Exit codes are the product here as much as the output is:
 *   0  the brief was produced, and the verdict cleared whatever `--fail-on` allows
 *   1  the verdict did not clear `--fail-on`
 *   2  the brief could not be produced at all
 *
 * The distinction matters to the job running this. A held change and a broken tool both
 * stop a pipeline, and treating them the same teaches everyone to ignore the failure.
 */

const USAGE = `blast — a pre-ship impact brief for a pull request

usage
  blast brief <pr-number|branch|fixture> [options]

options
  --intent <text>     what the change is for, in user-facing terms (required)
  --post              post the brief to the pull request, or update the one there
  --fail-on <verdict> exit 1 when the verdict is this or worse: hold | ship-with-caveats
  --format <fmt>      markdown (default) | json
  --policy <path>     a blast.json to apply, instead of searching upwards
  --help              this

exit codes
  0  brief produced and the verdict cleared --fail-on
  1  the verdict did not clear --fail-on
  2  the brief could not be produced
`;

/** Worst first, so `--fail-on ship-with-caveats` also fails a hold. */
const SEVERITY: Record<Verdict, number> = {
  hold: 2,
  "ship-with-caveats": 1,
  ship: 0,
};

interface Options {
  ref: string;
  intent: string;
  post: boolean;
  failOn: Verdict | null;
  format: "markdown" | "json";
  policy: string | null;
}

function parseArgs(argv: readonly string[]): Options | { error: string } {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { error: USAGE };
  if (command !== "brief") return { error: `Unknown command ${command}.\n\n${USAGE}` };

  const ref = rest[0];
  if (ref === undefined || ref.startsWith("-")) {
    return { error: `A pull request number, a branch, or 'fixture' is required.\n\n${USAGE}` };
  }

  const options: Options = {
    ref,
    intent: "",
    post: false,
    failOn: null,
    format: "markdown",
    policy: null,
  };

  for (let index = 1; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];

    switch (flag) {
      case "--post":
        options.post = true;
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
      case "--help":
      case "-h":
        return { error: USAGE };
      default:
        return { error: `Unknown option ${flag}.\n\n${USAGE}` };
    }
  }

  if (options.intent === "") {
    /**
     * Refused rather than defaulted. A diff says what moved and never what it is for,
     * and the measurability dimension is the one that most needs the difference — a
     * brief written against an invented intent reads exactly like one written against a
     * real one.
     */
    return { error: "--intent is required: one line on what the change is for.\n\n" + USAGE };
  }

  return options;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return parsed.error === USAGE ? 0 : 2;
  }

  let profile: ChangeProfile;
  let notes: string[];

  if (parsed.ref === "fixture") {
    const fixture = loadFixtureChangeProfile();
    if (!fixture.ok) {
      process.stderr.write(`blast: ${fixture.detail}\n`);
      return 2;
    }
    profile = fixture.value;
    notes = ["Read from the checked-in sample pull request."];
  } else {
    const read = await readChange({ ref: parsed.ref, intent: parsed.intent });
    if (!read.ok) {
      process.stderr.write(`blast: ${read.detail}\n`);
      return 2;
    }
    profile = read.value.profile;
    notes = read.value.notes;
  }

  /**
   * A named policy file that cannot be read stops the run here rather than falling back.
   * A pipeline that asked for its own budgets and silently got the defaults would gate
   * merges on ceilings nobody chose, and every run would look ordinary.
   */
  let policy;
  if (parsed.policy !== null) {
    const loaded = await loadPolicy({ path: parsed.policy });
    if (!loaded.ok) {
      process.stderr.write(`blast: ${loaded.detail}\n`);
      return 2;
    }
    policy = loaded.value;
  }

  const produced = await produceBrief({
    profile: { ...profile, intent: parsed.intent },
    /**
     * No model ran, so nothing here writes a narrative. Saying that plainly is better
     * than a generated sentence that reads like judgement and is not: the dimension
     * rationales below it are the rules' own words, and they are the honest version.
     */
    headline:
      "Produced without a model, so this line is not an assessment. The verdict, every number, and the remediations below are code over the evidence; the dimension rationales say which rule decided what.",
    ...(policy === undefined ? {} : { policy }),
  });

  if (!produced.ok) {
    process.stderr.write(`blast: ${produced.detail}\n`);
    return 2;
  }

  const { brief, markdown } = produced.value;

  if (parsed.format === "json") {
    process.stdout.write(`${JSON.stringify({ brief, markdown, notes }, null, 2)}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
    // Notes go to stderr so `blast brief … > brief.md` is the brief and nothing else.
    for (const note of notes) process.stderr.write(`note: ${note}\n`);
  }

  if (parsed.post) {
    if (brief.ref.kind !== "pr") {
      process.stderr.write("blast: --post needs a pull request number, not a branch.\n");
      return 2;
    }
    const outcome = await postBrief({ pullRequest: brief.ref.id, markdown });
    if (!outcome.ok) {
      process.stderr.write(
        `blast: the brief was produced but not posted. ${outcome.failure.detail}\n`,
      );
      return 2;
    }
    process.stderr.write(`blast: ${outcome.action} (${brief.digest}).\n`);
  }

  if (parsed.failOn !== null && SEVERITY[brief.verdict] >= SEVERITY[parsed.failOn]) {
    process.stderr.write(
      `blast: verdict is ${brief.verdict}, which does not clear --fail-on ${parsed.failOn}.\n`,
    );
    return 1;
  }

  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Nothing should reach here; if it does, say so rather than exiting 1 and looking
    // like a held verdict.
    process.stderr.write(`blast: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 2;
  });
