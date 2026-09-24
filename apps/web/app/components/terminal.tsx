"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The demo, played rather than recorded.
 *
 * A screen recording would be the obvious thing here and the wrong one. It would be a
 * megabyte of video to show forty characters of text, it would go stale the first time a
 * figure moved, and nobody could select a line out of it. This plays the same run as
 * text — and the lines are handed in from the server, computed by the engine, so the
 * number in the demo and the number in the brief below it are the same value. A recording
 * is the one artifact on a page like this that can quietly start lying.
 *
 * It starts when it is scrolled to, not on load, because a demo that has already finished
 * by the time you reach it has not been shown to anybody.
 */

export type LineKind = "command" | "output" | "muted" | "risk" | "ok" | "blank";

export interface TerminalLine {
  kind: LineKind;
  text: string;
  /** Rendered to the right, in the way a terminal prints a figure after a label. */
  value?: string;
}

const TYPE_MS = 22;
const LINE_MS = 90;

export function Terminal({ lines, caption }: { lines: readonly TerminalLine[]; caption: string }) {
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  /**
   * False until this has mounted, which is what makes the markup honest.
   *
   * The server renders the finished transcript — every line, and the command in full.
   * Only once there is a client to play it does the terminal take over and hide what it
   * has not reached yet. Rendering the empty state on the server instead would put a
   * prompt with no command into the HTML, which is what anything without JavaScript, and
   * every crawler, would read.
   */
  const [live, setLive] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  const command = lines[0]?.text ?? "";
  const rest = lines.slice(1);

  /**
   * Anything that prefers less motion gets the finished transcript, immediately. The
   * animation is the presentation; the text is the content, and the content is what the
   * page is for.
   */
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches) {
      setTyped(command.length);
      setShown(rest.length);
      setDone(true);
      return;
    }

    setLive(true);
    const node = frame.current;
    if (node === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [command.length, rest.length]);

  // The command types; the output does not. That is how the real thing behaves, and a
  // terminal where the output types itself character by character reads as a toy.
  useEffect(() => {
    if (!playing || typed >= command.length) return;
    const timer = setTimeout(() => {
      setTyped((count) => count + 1);
    }, TYPE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [playing, typed, command.length]);

  useEffect(() => {
    if (!playing || typed < command.length || shown >= rest.length) {
      if (playing && typed >= command.length && shown >= rest.length) setDone(true);
      return;
    }
    const line = rest[shown];
    const timer = setTimeout(
      () => {
        setShown((count) => count + 1);
      },
      line?.kind === "blank" ? LINE_MS / 3 : LINE_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [playing, typed, shown, command.length, rest]);

  function replay() {
    setTyped(0);
    setShown(0);
    setDone(false);
    setPlaying(true);
  }

  // Before it is live the transcript is simply the transcript; after, it is played.
  const commandText = live && playing ? command.slice(0, typed) : live ? "" : command;

  return (
    <div className={`term${live ? " term--live" : ""}`} ref={frame}>
      <div className="term__bar">
        <span className="term__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="term__caption mono">{caption}</span>
        <button
          type="button"
          className="term__replay"
          onClick={replay}
          // Nothing to replay until it has played, and a control that does nothing yet is
          // worse than one that is not there.
          disabled={!done}
        >
          Replay
        </button>
      </div>

      {/*
        A live region so the transcript is announced as it fills, and the whole thing is
        in the DOM from the first render either way — the animation only decides when each
        line becomes visible, never whether it exists.
      */}
      <pre className="term__body" aria-live="polite" aria-atomic="false">
        <code>
          <span className="term__line term__line--command">
            <span className="term__prompt" aria-hidden="true">
              $
            </span>
            <span>{commandText}</span>
            {live && !done && <span className="term__caret" aria-hidden="true" />}
          </span>
          {rest.map((line, index) => (
            <span
              key={`${line.kind}-${line.text}-${index}`}
              className={`term__line term__line--${line.kind}${index < shown ? " term__line--in" : ""}`}
              aria-hidden={live && index >= shown}
            >
              {/* Every command gets a prompt, not only the first one typed. */}
              {line.kind === "command" && (
                <span className="term__prompt" aria-hidden="true">
                  $
                </span>
              )}
              <span>{line.text}</span>
              {line.value !== undefined && <span className="term__value">{line.value}</span>}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
