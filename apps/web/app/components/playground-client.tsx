"use client";

import { useEffect, useId, useState } from "react";
import type { Enforcement } from "@blast/core";
import { CopyButton } from "./copy";
import { Snippet } from "./snippet";
import { StatusBadge } from "./status";
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
 */

const COST = { min: 50, max: 1000, step: 10, initial: 500 } as const;
const LCP = { min: 20, max: 500, step: 10, initial: 200 } as const;
const ATTRIBUTION_RULE = "measurability.feature-events";
const LEVELS: readonly Enforcement[] = ["block", "warn", "silent"];

const VERDICT_WORD = {
  ship: "ship",
  "ship-with-caveats": "ship with caveats",
  hold: "hold",
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

export function PlaygroundClient({
  initial,
  fixture,
}: {
  initial: WhatIf;
  /** The change's own figures, so a reader knows what a ceiling is being compared to. */
  fixture: { cost: string; lcp: string; events: string };
}) {
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
        <div className="control">
          <div className="control__head">
            <label className="control__label" htmlFor={`${ids}-cost`}>
              Monthly spend ceiling
            </label>
            <output className="control__value" htmlFor={`${ids}-cost`}>
              ${knobs.cost}
            </output>
          </div>
          <input
            id={`${ids}-cost`}
            className="range"
            type="range"
            min={COST.min}
            max={COST.max}
            step={COST.step}
            value={knobs.cost}
            onChange={(event) => {
              setKnobs((current) => ({ ...current, cost: Number(event.target.value) }));
            }}
          />
          <p className="control__hint">
            This change: <b>{fixture.cost}</b> a month, modeled
          </p>
        </div>

        <div className="control">
          <div className="control__head">
            <label className="control__label" htmlFor={`${ids}-lcp`}>
              p75 LCP allowance
            </label>
            <output className="control__value" htmlFor={`${ids}-lcp`}>
              {knobs.lcp}ms
            </output>
          </div>
          <input
            id={`${ids}-lcp`}
            className="range"
            type="range"
            min={LCP.min}
            max={LCP.max}
            step={LCP.step}
            value={knobs.lcp}
            onChange={(event) => {
              setKnobs((current) => ({ ...current, lcp: Number(event.target.value) }));
            }}
          />
          <p className="control__hint">
            This change: <b>{fixture.lcp}</b>, measured
          </p>
        </div>

        <div className="control">
          <div className="control__head">
            <span className="control__label" id={`${ids}-attribution`}>
              Attributable events rule
            </span>
          </div>
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
            This change: <b>{fixture.events}</b> attributable events. Enforcement decides whether a
            breach can stop the merge.
          </p>
        </div>
      </div>

      <div className="play__result" aria-live="polite" aria-busy={state === "deciding"}>
        <div className="play__verdict">
          <span className={`pill pill--${result.verdict}`}>
            <span className="pill__dot" aria-hidden="true" />
            {VERDICT_WORD[result.verdict]}
          </span>
          <span className="play__meta">
            confidence {result.confidence} · exit code <b>{result.exitCode}</b> under{" "}
            <code>--fail-on hold</code>
          </span>
          <span className="play__state" role="status">
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

        <div className="play__grid">
          <div className="play__column">
            <ul className="dims">
              {(Object.keys(DIMENSION_LABEL) as (keyof typeof DIMENSION_LABEL)[]).map(
                (dimension) => {
                  const report = result.dimensions[dimension];
                  return (
                    <li className="dims__row" key={dimension}>
                      <div className="dims__head">
                        <span className="dims__name">{DIMENSION_LABEL[dimension]}</span>
                        <StatusBadge status={report.status} />
                      </div>
                      <p className="dims__why">{report.rationale}</p>
                    </li>
                  );
                },
              )}
            </ul>

            <div className="fired">
              <p className="fired__label">Rules that fired</p>
              {result.rules.length === 0 ? (
                <p className="fired__none">
                  None. Nothing crossed a threshold under these budgets.
                </p>
              ) : (
                <ul className="fired__list">
                  {result.rules.map((rule) => (
                    <li className="fired__row" key={`${rule.id}-${rule.outcome}`}>
                      <span className="fired__id">{rule.id}</span>
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
              <b>{result.digest}</b>
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
              foot={
                atDefaults
                  ? "Nothing is set, so the defaults apply. Every brief names the budgets it used."
                  : undefined
              }
            >
              {document}
            </Snippet>
          </div>
        </div>
      </div>
    </div>
  );
}
