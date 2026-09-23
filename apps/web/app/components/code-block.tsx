export interface CodeLine {
  kind: "add" | "del" | "context";
  text: string;
  /** Rendered beside the line, outside the scrolling region. */
  cost?: string;
}

const ROW: Record<CodeLine["kind"], string> = {
  add: "code__row code__row--add",
  del: "code__row code__row--del",
  context: "code__row",
};

const SIGN: Record<CodeLine["kind"], string> = { add: "+", del: "-", context: " " };

const LABEL: Record<CodeLine["kind"], string> = {
  add: "added line",
  del: "removed line",
  context: "unchanged line",
};

/**
 * A diff, with the cost of a line beside it.
 *
 * The annotation is the product in one gesture: the line is unremarkable until
 * something puts a number next to it, which is the review this tool exists to improve.
 *
 * The cost sits outside the scrolling element rather than inside it. Within it, an
 * auto margin measures the visible width rather than the scrolled one, and the badge
 * lands on top of the code on any screen too narrow for the line.
 *
 * Each line scrolls, so each is focusable, so each is a landmark and needs a name of
 * its own. The block's label plus the line's content supplies one.
 */
export function CodeBlock({
  lines,
  caption,
  label,
}: {
  lines: CodeLine[];
  caption?: string;
  /** Names this block, so each scrollable line is a distinctly labelled region. */
  label: string;
}) {
  return (
    <div>
      <pre className="code">
        {lines.map((line, index) => (
          <div className={ROW[line.kind]} key={`${index}-${line.text}`}>
            <span
              className="code__line"
              tabIndex={0}
              role="region"
              aria-label={`${label}, ${LABEL[line.kind]}: ${line.text}`}
            >
              <span className="code__sign" aria-hidden="true">
                {SIGN[line.kind]}
              </span>
              <span className="code__text">{line.text}</span>
            </span>
            {line.cost !== undefined && <span className="code__cost">{line.cost}</span>}
          </div>
        ))}
      </pre>
      {caption !== undefined && <p className="code__meta">{caption}</p>}
    </div>
  );
}
