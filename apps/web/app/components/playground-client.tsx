"use client";

import { useEffect, useId, useState } from "react";
import type { Enforcement } from "@blast/core";
import { CopyButton } from "./copy";
import { Ledger } from "./ledger";
import { Snippet } from "./snippet";
import type { WhatIf } from "../what-if-shape";

/**
 * Three knobs, one per dimension, and the decision they produce.
 *
 * The monthly ceiling and the LCP allowance are budgets; the attributable-events rule has
 * no number to move, so its knob is enforcement — which is the more interesting one, since
 * it is the difference between "this is bad" and "this may stop the merge" that the policy
 * system keeps separate. Moving any of them re-runs the engine on the server. The client
 * draws what comes back and computes nothing: a verdict decided in a browser would be a
 * second engine, and two engines agree until they do not.
 *
 * Each budget slider carries a mark where this change sits on its scale, so the reader
 * is not moving a number in the abstract: they are moving a ceiling over a measured
 * value, and can see the moment it passes under.
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

const DIMENSION_LABEL = {
  performance: "Performance",
  cost: "Infrastructure cost",
  measurability: "Measurability",
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

/**
 * A budget slider with the change's own value marked on its scale.
 */
function Budget({
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
  const place =
    measured === null
      ? null
      : Math.min(100, Math.max(0, ((measured - range.min) / (range.max - range.min)) * 100));
  const over = measured !== null && measured > value;

  return (
    <div className={`control${over ? " control--over" : ""}`}>
      <label className="control__label" htmlFor={id}>
        {label}
      </label>
      <output className="control__value mono" htmlFor={id}>
        {format(value)}
      </output>
      <div className="control__track">
        <input
          id={id}
          className="range"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
        />
        {place !== null && (
          <span
            className={`control__mark${place < 18 ? " control__mark--start" : place > 82 ? " control__mark--end" : ""}`}
            style={{ left: `${place}%` }}
            aria-hidden="true"
          >
            <span className="control__mark-label">
              this change <b className="mono">{measuredLabel}</b>
            </span>
          </span>
        )}
      </div>
      <p className="control__hint">
        {over ? "Over the ceiling, so the rule fires." : "Inside the ceiling."}
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
    // Back at the defaults, the answer is the one the server already computed.
    if (query === initial.query) {
      setResult(initial);
      setState("settled");
      return;
    }

    const controller = new AbortController();
    setState("deciding");
    // A slider emits dozens of values a second; the engine is asked once it settles.
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

  return (
    <div className="play">
      <div className="play__controls">
        <Budget
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
        <Budget
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
        <div className="control">
          <span className="control__label" id={`${ids}-attribution`}>
            Attributable events rule
          </span>
          <output className="control__value mono">{fixture.events} events</output>
          <div className="seg" role="radiogroup" aria-labelledby={`${ids}-attribution`}>
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={knobs.attribution === level}
                className={`seg__btn${knobs.attribution === level ? " seg__btn--on" : ""}`}
                onClick={() => {
                  setKnobs((current) => ({ ...current, attribution: level }));
                }}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="control__hint">
            {knobs.attribution === "block"
              ? "A breach can stop the merge."
              : knobs.attribution === "warn"
                ? "A breach is reported and the merge goes ahead."
                : "A breach is recorded and nothing is said."}
          </p>
        </div>
      </div>

      <div className="play__result" aria-live="polite" aria-busy={state === "deciding"}>
        <div className="verdict-head verdict-head--play">
          <div className="verdict-head__word">
            <p className={`verdict-word verdict-word--${result.verdict}`}>
              {VERDICT_WORD[result.verdict]}
              <span className="verdict-word__point">.</span>
            </p>
            <p className="verdict-head__meta mono">
              confidence {result.confidence} · exit <b>{result.exitCode}</b> under{" "}
              <code>--fail-on hold</code>
            </p>
          </div>
          <div className="play__aside">
            <span className="play__state mono" role="status">
              {state === "deciding" ? "deciding…" : state === "failed" ? failure : ""}
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={atDefaults}
              onClick={() => {
                setKnobs(INITIAL);
              }}
            >
              Back to defaults
            </button>
          </div>
        </div>

        <div className="play__grid">
          <div className="play__column">
            <Ledger
              rows={(Object.keys(DIMENSION_LABEL) as (keyof typeof DIMENSION_LABEL)[]).map(
                (dimension) => ({
                  id: dimension,
                  name: DIMENSION_LABEL[dimension],
                  status: result.dimensions[dimension].status,
                  rationale: result.dimensions[dimension].rationale,
                }),
              )}
            />

            <div className="fired">
              <h4 className="fired__label">Rules that fired</h4>
              {result.rules.length === 0 ? (
                <p className="fired__none">
                  None. Nothing crossed a threshold under these budgets.
                </p>
              ) : (
                <ul className="fired__list">
                  {result.rules.map((rule) => (
                    <li className="fired__row" key={`${rule.id}-${rule.outcome}`}>
                      <span className="fired__id mono">{rule.id}</span>
                      <span className={`fired__tag fired__tag--${rule.enforcement}`}>
                        {rule.enforcement}
                      </span>
                      <span className="fired__tag">{rule.severity}</span>
                      {rule.outcome !== "triggered" && (
                        <span className="fired__tag">{rule.outcome}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="play__digest">
              <span className="play__digest-label">Digest</span>
              <b className="mono">{result.digest}</b>
              <span className="play__digest-note">
                {atDefaults
                  ? "The page's own. Change a budget and it changes."
                  : "The budgets changed, so the digest did. Same budgets, same digest, anywhere."}
              </span>
            </p>
          </div>

          <div className="play__column">
            <Snippet
              name="blast.json"
              action={
                <CopyButton
                  value={document}
                  label="Copy"
                  copiedLabel="Copied"
                  className="snippet__copy"
                />
              }
              foot={atDefaults ? "Nothing is set, so the defaults apply." : undefined}
            >
              {document}
            </Snippet>
          </div>
        </div>
      </div>
    </div>
  );
}
