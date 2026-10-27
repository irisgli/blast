import type { ReactNode } from "react";

/**
 * A section of the page and the head it opens with.
 *
 * Heads vary on purpose: that variation is the cadence that replaces a label or a number
 * above every title. `split` sets the title left and the line right; `rail` puts the head
 * in a column beside the body, where it stays while the body is read; the default stacks
 * a title over one line.
 */
export function Section({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `section ${className}` : "section"} id={id}>
      <div className="shell">{children}</div>
    </section>
  );
}

export function SectionHead({
  title,
  variant = "stack",
  children,
}: {
  title: string;
  variant?: "stack" | "split" | "rail";
  children: ReactNode;
}) {
  return (
    <div className={`head head--${variant}`} data-reveal="head">
      <h2 className="title">{title}</h2>
      <p className="lede">{children}</p>
    </div>
  );
}
