import type { ReactNode } from "react";

/**
 * Numbered steps, each one showing the file or command it is about.
 *
 * The page's job is to make someone believe they could run this by Friday, and prose
 * cannot do that on its own: what convinces is seeing the actual `blast.json`, the actual
 * workflow, the actual exit code. So every step is a sentence or two beside the real
 * thing, and the real thing is the larger half.
 */

export interface Step {
  /** A short imperative: what the reader would do. */
  title: string;
  body: string;
  /** What this leans on, when it is worth naming. */
  leverages?: string;
  code: ReactNode;
}

export function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="steps-flow">
      {steps.map((step, index) => (
        <li className="step-row" key={step.title}>
          <div className="step-row__text">
            <span className="step-row__index mono">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="step-row__title">{step.title}</h3>
            <p className="step-row__body">{step.body}</p>
            {step.leverages !== undefined && (
              <p className="step-row__leverages">
                <span className="step-row__leverages-label">Leverages</span>
                <span className="mono">{step.leverages}</span>
              </p>
            )}
          </div>
          <div className="step-row__code">{step.code}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A plain code panel with an optional filename.
 *
 * Distinct from `CodeBlock`, which renders a diff and prices its lines. This one is for
 * showing a file as it would be written.
 */
export function Snippet({ name, children }: { name?: string; children: string }) {
  return (
    <figure className="snippet">
      {name !== undefined && <figcaption className="snippet__name mono">{name}</figcaption>}
      <pre className="snippet__body">
        <code>{children}</code>
      </pre>
    </figure>
  );
}
