"use client";

import { useEffect, useState } from "react";

/**
 * Copies a string, and says so for two seconds.
 *
 * On this page the string worth copying is the brief itself — someone reading it has a
 * pull request open in the next tab, and the markdown is what goes in the comment. That
 * is one keystroke away from being the whole product for a team not ready to install
 * anything yet.
 *
 * The clipboard API needs a secure context and permission, and it throws rather than
 * returning false when it has neither. A button that silently did nothing would be worse
 * than one that says it could not, so the failure is a state like the success is.
 */
export function CopyButton({
  value,
  label,
  copiedLabel = "Copied",
  className = "btn btn--ghost",
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => {
      setState("idle");
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setState("copied");
          },
          () => {
            setState("failed");
          },
        );
      }}
    >
      {/* Announced, because the only feedback is the label changing. */}
      <span aria-live="polite">
        {state === "copied" ? copiedLabel : state === "failed" ? "Press ⌘C instead" : label}
      </span>
    </button>
  );
}
