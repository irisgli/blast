import type { ReactNode } from "react";

/**
 * A file as it would be written: a name, the text, and an optional line under it.
 *
 * Distinct from `CodeBlock`, which renders a diff and prices its lines.
 */
export function Snippet({
  name,
  children,
  action,
  foot,
}: {
  name?: string;
  children: string;
  /** Rendered at the right of the name, for a copy button. */
  action?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <figure className="snippet">
      {name !== undefined && (
        <figcaption className="snippet__name">
          <span>{name}</span>
          {action}
        </figcaption>
      )}
      <pre className="snippet__body">
        <code>{children}</code>
      </pre>
      {foot !== undefined && <p className="snippet__foot">{foot}</p>}
    </figure>
  );
}
