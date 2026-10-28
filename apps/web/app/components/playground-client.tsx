"use client";

import { useEffect, useId, useState } from "react";
import type { Enforcement } from "@blast/core";
import { CopyButton } from "./copy";
import type { WhatIf } from "../what-if-shape";

/**
 * Three ceilings over one measured change, and the verdict they produce.
 *
 * Each rail is a scale. The change's own value sits on it as a fixed mark; the ceiling
 * is the handle a reader drags. The moment the ceiling passes under the mark, the span
 * between them turns the verdict's colour, the engine is asked again on the server, and
 * the stamp on the right flips. The attributable-events rule has no number to move, so
 * its control is enforcement, which is the difference between "this is bad" and "this
 * may stop the merge".
 *
 * Nothing is decided here. The client draws what comes back from `/api/what-if` and
 * computes nothing: a verdict decided in a browser would be a second engine, and two
 * engines agree until they do not.
 */

const COST = { min: 50, max: 1000, step: 10, initial: 500 } as const;
const LCP = { min: 20, max: 500, step: 10, initial: 200 } as const;
const ATTRIBUTION_RULE = "measurability.feature-events";
const LEVELS: readonly Enforcement[] = ["block", "warn", "silent"];

const VERDICT_WORD = {
  ship: "Ship",
  "ship-with-caveats": "Ship with caveats",
  hold: "Hold",
} as const;

interface Knobs {
  cost: number;
  lcp: number;
  attribution: Enforcement;
}

const INITIAL: Knobs = { cost: COST.initial, lcp: LCP.initial, attribution: "block" };

/** Only what differs from the defaults travels, so the default query is empty. */
function queryFor(knobs: Knobs): string {
  const params = new URLSearchParams();
  if (knobs.cost !== COST.initial) params.set("budget.monthlyCostDeltaUsd", String(knobs.cost));
  if (knobs.lcp !== LCP.initial) params.set("budget.lcpDeltaMs", String(knobs.lcp));
  if (knobs.attribution !== "block") params.set(`enforce.${ATTRIBUTION_RULE}`, knobs.attribution);
  return params.toString();
}

export interface Fixture {
  /** The change's own modeled spend, in dollars a month; null when unmeasured. */
  costUsd: number | null;
  /** The change's own measured LCP delta, in milliseconds; null when unmeasured. */
  lcpMs: number | null;
  /** The attributable events it ships, already formatted. */
  events: string;
}

function Rail({
  id,
  label,
  value,
  range,
  format,
  measured,
  measuredLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  format: (value: number) => string;
  measured: number | null;
  measuredLabel: string;
  onChange: (value: number) => void;
}) {
  const place = (at: number) =>
    Math.min(100, Math.max(0, ((at - range.min) / (range.max - range.min)) * 100));
  const mark = measured === null ? null : place(measured);
  const ceiling = place(value);
  const over = measured !== null && measured > value;

  return (
    <div className={`rail${over ? " rail--over" : ""}`}>
      <div className="rail__head">
        <label className="rail__label" htmlFor={id}>
          {label}
        </label>
        <output className="rail__ceiling" htmlFor={id}>
          {format(value)}
        </output>
      </div>
      <div className="rail__track">
        {mark !== null && (
          <>
            <span
              className="rail__span"
              style={{
                left: `${Math.min(mark, ceiling)}%`,
                width: `${Math.abs(mark - ceiling)}%`,
              }}
              aria-hidden="true"
            />
            <span className="rail__mark" style={{ left: `${mark}%` }} aria-hidden="true">
              <span className={`rail__mark-label${mark > 70 ? " rail__mark-label--end" : ""}`}>
                this change {measuredLabel}
              </span>
            </span>
          </>
        )}
        <input
          id={id}
          className="rail__input"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
        />
      </div>
      <p className="rail__read" aria-live="polite">
        {measured === null
          ? "Unmeasured, so no ceiling applies."
          : over
            ? `${measuredLabel} is over ${format(value)}. The rule fires.`
            : `${measuredLabel} is inside ${format(value)}.`}
      </p>
    </div>
  );
}

export function PlaygroundClient({ initial, fixture }: { initial: WhatIf; fixture: Fixture }) {
  const [knobs, setKnobs] = useState<Knobs>(INITIAL);
  const [result, setResult] = useState<WhatIf>(initial);
  const [state, setState] = useState<"settled" | "deciding" | "failed">("settled");
  const [failure, setFailure] = useState("");
  const ids = useId();
  const query = queryFor(knobs);

  useEffect(() => {
    if (query === initial.query) {
      setResult(initial);
      setState("settled");
      return;
    }

    const controller = new AbortController();
    setState("deciding");
    const timer = setTimeout(() => {
      fetch(`/api/what-if?${query}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      })
        .then(async (response) => {
          const body = (await response.json()) as WhatIf | { error?: { message?: string } };
          if (!response.ok || !("verdict" in body)) {
            const message = "error" in body ? body.error?.message : undefined;
            throw new Error(message ?? `The engine answered ${response.status}.`);
          }
          setResult(body);
          setState("settled");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setFailure(error instanceof Error ? error.message : String(error));
          setState("failed");
        });
    }, 140);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, initial]);

  const document = JSON.stringify(result.policy.document, null, 2);
  const atDefaults = query === "";
  const fired = result.rules.filter((rule) => rule.outcome === "triggered");

  return (
    <div className="play">
      <div className="play__rails">
        <Rail
          id={`${ids}-cost`}
          label="Monthly spend ceiling"
          value={knobs.cost}
          range={COST}
          format={(value) => `$${value}`}
          measured={fixture.costUsd}
          measuredLabel={
            fixture.costUsd === null ? "unmeasured" : `+$${fixture.costUsd.toFixed(2)}`
          }
          onChange={(cost) => {
            setKnobs((current) => ({ ...current, cost }));
          }}
        />
        <Rail
          id={`${ids}-lcp`}
          label="p75 LCP allowance"
          value={knobs.lcp}
          range={LCP}
          format={(value) => `${value}ms`}
          measured={fixture.lcpMs}
          measuredLabel={fixture.lcpMs === null ? "unmeasured" : `+${Math.round(fixture.lcpMs)}ms`}
          onChange={(lcp) => {
            setKnobs((current) => ({ ...current, lcp }));
          }}
        />
        <div className="rail rail--switch">
          <div className="rail__head">
            <span className="rail__label" id={`${ids}-attribution`}>
              Attributable events rule
            </span>
            <span className="rail__ceiling">{fixture.events} events</span>
          </div>
          <div className="switch" role="radiogroup" aria-labelledby={`${ids}-attribution`}>
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={knobs.attribution === level}
                className={`switch__opt${knobs.attribution === level ? " switch__opt--on" : ""}`}
                onClick={() => {
                  setKnobs((current) => ({ ...current, attribution: level }));
                }}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="rail__read">
            {knobs.attribution === "block"
              ? "A breach can stop the merge."
              : knobs.attribution === "warn"
                ? "A breach is reported and the merge goes ahead."
                : "A breach is recorded and nothing is said."}
          </p>
        </div>
        <button
          type="button"
          className="play__reset"
          disabled={atDefaults}
          onClick={() => {
            setKnobs(INITIAL);
          }}
        >
          Back to defaults
        </button>
      </div>

      <div
        className={`stamp stamp--${result.verdict}${state === "deciding" ? " stamp--deciding" : ""}`}
        aria-live="polite"
        aria-busy={state === "deciding"}
      >
        <p className={`verdict verdict--${result.verdict}`} key={result.digest}>
          {VERDICT_WORD[result.verdict]}
          <span className="verdict__point">.</span>
        </p>
        <p className="stamp__exit">
          exit <b>{result.exitCode}</b> under <code>--fail-on {result.gate}</code>
          <span className="stamp__state" role="status">
            {state === "deciding" ? "deciding…" : state === "failed" ? failure : ""}
          </span>
        </p>

        <div className="stamp__rules">
          <h3 className="stamp__h">Rules that fired</h3>
          {fired.length === 0 ? (
            <p className="stamp__none">None. Nothing crossed a line under these budgets.</p>
          ) : (
            <ul className="fired">
              {fired.map((rule) => (
                <li key={rule.id} className={`fired__row fired__row--${rule.enforcement}`}>
                  <span className="fired__title">{rule.title}</span>
                  <span className="fired__enf">{rule.enforcement}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="stamp__file" open={!atDefaults}>
          <summary>
            <span>blast.json</span>
            <span className="stamp__digest">digest {result.digest}</span>
          </summary>
          <pre className="stamp__pre">
            <code>{document}</code>
          </pre>
          <div className="stamp__file-foot">
            <span>
              {atDefaults
                ? "Nothing set, so the defaults apply."
                : "Commit this and the gate decides the same way in CI."}
            </span>
            <CopyButton
              value={document}
              label="Copy"
              copiedLabel="Copied"
              className="stamp__copy"
            />
          </div>
        </details>
      </div>
    </div>
  );
}
