import "server-only";
import type { Metadata } from "next";
import { FileDecisionStore, FileReconciliationStore, decisionLogPath, reconciliationLogPath } from "@blast/brief";
import { MINIMUM_RECONCILIATIONS, summarize } from "@blast/core";
import type { AccuracyReport, AuditSummary } from "@blast/core";

/**
 * What the gate has actually done.
 *
 * The decision endpoint answers about one change. This answers the questions a platform team
 * has in the quarter *after* they install a gate, which are the ones that decide whether it
 * stays: which rules are doing work, which are being waived around, and what the model that
 * produced the numbers has been worth.
 *
 * It renders `summarize` from `@blast/core` — the same pure function `blast audit` prints — so
 * this page and the command cannot disagree about a total. That is the shared-engine invariant
 * applied to the aggregate: a dashboard that computed its own numbers would drift from the
 * command, and both would look right.
 *
 * Two things it refuses to do. It never calls a modeled sum savings, because the changes it
 * totals may have shipped anyway, in an amended form, or not at all, and this log does not know
 * which. And it shows the gap between held and blocked rather than hiding it, because a team
 * with many holds and no blocks has installed a gate and not turned it on — which is the most
 * common way this quietly stops working, and is invisible unless something says it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "blast — decisions",
  description: "Every decision blast has recorded, and what the rules behind them have been worth.",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

async function read(): Promise<
  { ok: true; summary: AuditSummary; accuracy: AccuracyReport } | { ok: false; detail: string }
> {
  try {
    const decisions = await new FileDecisionStore({ path: decisionLogPath() }).list({ limit: 1000 });
    const accuracy = await new FileReconciliationStore({
      path: reconciliationLogPath(),
    }).accuracy();
    return { ok: true, summary: summarize(decisions), accuracy };
  } catch (error) {
    return {
      ok: false,
      detail: `The decision log could not be read: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
}

export default async function AuditPage() {
  const result = await read();

  if (!result.ok) {
    return (
      <main className="shell">
        <section className="card">
          <div className="card__head">
            <h1 className="card__title">Decisions</h1>
          </div>
          <div className="card__body">
            <p className="empty">{result.detail}</p>
          </div>
        </section>
      </main>
    );
  }

  const { summary, accuracy } = result;

  if (summary.decisions === 0) {
    return (
      <main className="shell">
        <section className="card">
          <div className="card__head">
            <h1 className="card__title">Decisions</h1>
          </div>
          <div className="card__body">
            <p className="empty">
              Nothing has been recorded yet. Every <code className="mono">blast decide</code> and{" "}
              <code className="mono">blast brief</code> run appends to the log unless it is told
              not to; a deployment records server-side through{" "}
              <code className="mono">POST /api/v1/decision</code>.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const installedNotEnabled = summary.held > 0 && summary.blocked === 0;
  const busiest = summary.rules[0];
  /**
   * A waive rate over too few firings is not a pattern. Three is a low bar and it is still the
   * difference between "this rule is being routed around" and "somebody waived it once".
   */
  const ENOUGH_FIRINGS = 3;
  const judgeable = summary.rules.filter(
    (rule) => rule.waiveRate !== null && rule.fired + rule.waived >= ENOUGH_FIRINGS,
  );
  const mostWaived = [...judgeable].sort(
    (left, right) => (right.waiveRate ?? 0) - (left.waiveRate ?? 0),
  )[0];

  return (
    <main className="shell">
      <section className="card">
        <div className="card__head card__head--divided">
          <h1 className="card__title">Decisions</h1>
          <p className="card__hint">
            {summary.decisions} recorded. Computed by the same function{" "}
            <code className="mono">blast audit</code> prints.
          </p>
        </div>

        <div className="card__body">
          <div className="metrics">
            <article className="metric">
              <div className="metric__top">
                <span className="metric__label">Held</span>
                <span className="badge badge--risk">
                  <span className="badge__dot" />
                  {summary.held}
                </span>
              </div>
              <p className="metric__note">
                Changes blast said no to, whatever the caller then did about it.
              </p>
            </article>

            <article className="metric">
              <div className="metric__top">
                <span className="metric__label">Blocked by a gate</span>
                <span className={`badge ${summary.blocked > 0 ? "badge--risk" : "badge--unmeasured"}`}>
                  <span className="badge__dot" />
                  {summary.blocked}
                </span>
              </div>
              <p className="metric__note">
                {installedNotEnabled
                  ? "No caller is passing --fail-on, so nothing has been stopped. The gate is installed and not enabled."
                  : "Decisions whose verdict did not clear the gate the caller set."}
              </p>
            </article>

            <article className="metric">
              <div className="metric__top">
                <span className="metric__label">Monthly spend on held changes</span>
                <span className="metric__value mono">{money(summary.heldMonthlyCostUsd)}</span>
              </div>
              <p className="metric__note">
                Modeled, not billed. These changes may have shipped anyway, in an amended form, or
                not at all — the log does not know which, so this is not a savings figure.
              </p>
            </article>
          </div>

          <ul className="breakdown">
            {(["ship", "ship-with-caveats", "hold"] as const).map((verdict) => (
              <li className="breakdown__row" key={verdict}>
                <div className="breakdown__head">
                  <span className="breakdown__label">{verdict}</span>
                  <span className="breakdown__value mono">{summary.byVerdict[verdict]}</span>
                </div>
                <div
                  className="breakdown__track"
                  role="img"
                  aria-label={`${verdict}: ${summary.byVerdict[verdict]} of ${summary.decisions} decisions`}
                >
                  <span
                    className="breakdown__fill"
                    style={{ width: `${(summary.byVerdict[verdict] / summary.decisions) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <div className="card__head card__head--divided">
          <h2 className="card__title">Rules</h2>
          <p className="card__hint">
            A rule waived most of the times it fires is a rule the team disagrees with, whether or
            not anyone has said so. It is the honest version of a false-positive rate, and it is
            what to look at before turning another rule on.
          </p>
        </div>

        <div className="card__body">
          {summary.rules.length === 0 ? (
            <p className="empty">No rule has fired yet.</p>
          ) : (
            <ul className="breakdown">
              {summary.rules.map((rule) => (
                <li className="breakdown__row" key={rule.ruleId}>
                  <div className="breakdown__head">
                    <span className="breakdown__label mono">{rule.ruleId}</span>
                    <span className="breakdown__value mono">
                      {rule.waiveRate === null ? "—" : percent(rule.waiveRate)} waived
                    </span>
                  </div>
                  <div
                    className="breakdown__track"
                    role="img"
                    aria-label={`${rule.ruleId}: fired ${rule.fired}, waived ${rule.waived}, silent ${rule.observed}`}
                  >
                    <span
                      className="breakdown__fill"
                      style={{ width: `${(rule.waiveRate ?? 0) * 100}%` }}
                    />
                  </div>
                  <p className="breakdown__detail">
                    fired {rule.fired} · waived {rule.waived} · silent {rule.observed}
                    {rule.owner === null ? "" : ` · ${rule.owner}`}
                    {rule.repos.length > 0 ? ` · ${rule.repos.join(", ")}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {mostWaived !== undefined && (mostWaived.waiveRate ?? 0) > 0.5 && (
            <p className="note note--neutral">
              <code className="mono">{mostWaived.ruleId}</code> has been waived{" "}
              {percent(mostWaived.waiveRate ?? 0)} of the times it fired. Look at the threshold
              before promoting anything else.
            </p>
          )}
          {mostWaived !== undefined && (mostWaived.waiveRate ?? 0) <= 0.5 && (
            <p className="note note--ok">Nothing is being routinely waived around.</p>
          )}
          {/*
            No rule has fired often enough to read a rate off. Saying so beats saying nothing is
            being waived, which a single waiver on the list would immediately contradict.
          */}
          {mostWaived === undefined && busiest !== undefined && (
            <p className="note note--neutral">
              No rule has fired {ENOUGH_FIRINGS} times yet, so there is not enough here to call any
              of these rates a pattern.
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card__head card__head--divided">
          <h2 className="card__title">The cost model, against the bill</h2>
          <p className="card__hint">
            Every cost number blast produces is modeled. This is what that has been worth.
          </p>
        </div>

        <div className="card__body">
          {accuracy.records === 0 ? (
            <p className="empty">
              No change has been reconciled against a bill, so this model&rsquo;s error is unknown.
              Run <code className="mono">blast reconcile &lt;decision-id&gt; --observed …</code>{" "}
              once a bill arrives.
            </p>
          ) : (
            <>
              <div className="metrics">
                <article className="metric">
                  <div className="metric__top">
                    <span className="metric__label">Median absolute error</span>
                    <span className="metric__value mono">
                      {accuracy.medianAbsoluteErrorPct === null
                        ? "—"
                        : `${accuracy.medianAbsoluteErrorPct}%`}
                    </span>
                  </div>
                  <p className="metric__note">
                    Across {accuracy.records} reconciled change
                    {accuracy.records === 1 ? "" : "s"}.
                    {accuracy.records < MINIMUM_RECONCILIATIONS
                      ? ` Not quoted in briefs yet: ${MINIMUM_RECONCILIATIONS} are needed before a median means anything.`
                      : ""}
                  </p>
                </article>

                <article className="metric">
                  <div className="metric__top">
                    <span className="metric__label">Predicted / billed</span>
                    <span className="metric__value mono">
                      {money(accuracy.totalPredictedUsd)} / {money(accuracy.totalObservedUsd)}
                    </span>
                  </div>
                  <p className="metric__note">
                    {accuracy.underestimatedShare === null
                      ? ""
                      : accuracy.underestimatedShare > 0.6
                        ? "The model usually reads low."
                        : accuracy.underestimatedShare < 0.4
                          ? "The model usually reads high."
                          : "The model misses in both directions about evenly."}
                  </p>
                </article>
              </div>

              {accuracy.worst !== null && (
                <p className="accuracy__miss">
                  Worst miss: {accuracy.worst.errorPct}% on{" "}
                  <code className="mono">{accuracy.worst.decisionId}</code> — predicted{" "}
                  {money(accuracy.worst.predicted)}, billed {money(accuracy.worst.observed)}.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {summary.lapsedExceptions.length > 0 && (
        <section className="card">
          <div className="card__head card__head--divided">
            <h2 className="card__title">Lapsed exceptions</h2>
            <p className="card__hint">
              These rules fired while an exception that had already expired still named them. The
              exception did not apply, and nobody was told.
            </p>
          </div>
          <div className="card__body">
            <ul className="breakdown">
              {summary.lapsedExceptions.map((entry) => (
                <li className="breakdown__row" key={entry.ruleId}>
                  <div className="breakdown__head">
                    <span className="breakdown__label mono">{entry.ruleId}</span>
                    <span className="breakdown__value mono">{entry.count}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
