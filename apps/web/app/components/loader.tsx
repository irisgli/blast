"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

gsap.registerPlugin(DrawSVGPlugin);

/**
 * The curtain the page opens with: the mark draws its two rings on the dark, the name
 * settles beside it, and the curtain lifts into the hero. About a second, once per
 * session.
 *
 * It is rendered by the server, so it is already covering the page at first paint and
 * there is nothing to flash. The client lifts it; the page's entrance waits for
 * `blast:loader` and begins as the curtain goes, so the two overlap rather than queue.
 *
 * Four ways it gets out of the way without the script. A second visit in the same
 * session skips it, because a curtain is a greeting and not a toll. `prefers-reduced-motion`
 * removes it at once. Without JavaScript a `<noscript>` rule hides it. And if this file
 * never runs, the stylesheet removes it two and a half seconds in; a page that stays
 * behind a curtain is not a page with a loader, it is a broken one.
 */

export const LOADER_EVENT = "blast:loader";
const SEEN_KEY = "blast:loader-seen";

/** Unhides the page when there is no script coming to lift the curtain. */
export const NO_SCRIPT_LOADER_CSS = ".loader{display:none !important}";

function seen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode, or storage refused: the curtain simply plays again next time.
  }
}

export function Loader() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const done = () => {
      // Remembered here rather than at mount: in development React runs effects twice,
      // and a flag set on the first run would make the second run skip the curtain.
      remember();
      root.setAttribute("data-done", "");
      window.dispatchEvent(new CustomEvent(LOADER_EVENT));
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || seen()) {
      root.remove();
      done();
      return;
    }

    const rings = gsap.utils.toArray<SVGPathElement>("path", root);
    const name = root.querySelector<HTMLElement>(".loader__name");
    const readout = root.querySelector<HTMLElement>(".loader__readout b");
    const counter = { value: 0 };
    const timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: () => root.remove(),
    });

    timeline
      .fromTo(rings, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.7, stagger: 0.14, ease: "power2.inOut" }, 0.1)
      .to(
        counter,
        {
          value: 100,
          duration: 0.9,
          ease: "power2.inOut",
          onUpdate() {
            if (readout) readout.textContent = String(Math.round(counter.value)).padStart(3, "0");
          },
        },
        0.05,
      )
      .fromTo(name, { autoAlpha: 0, x: -6 }, { autoAlpha: 1, x: 0, duration: 0.5 }, 0.45)
      .add(done, 0.95)
      .to(root, { clipPath: "inset(0 0 100% 0)", duration: 0.7, ease: "expo.inOut" }, 0.95)
      .to([name, rings], { autoAlpha: 0, duration: 0.25 }, 1.0);

    return () => {
      timeline.kill();
    };
  }, []);

  return (
    <div className="loader" ref={ref} aria-hidden="true">
      <div className="loader__mark">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <circle cx="8" cy="12" r="3.25" fill="currentColor" />
          <path d="M13.5 7.5a6.4 6.4 0 0 1 0 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M17 4a11 11 0 0 1 0 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="loader__name">blast.</span>
      </div>
      <p className="loader__readout">
        <span>measuring the blast radius</span>
        <b>000</b>
      </p>
    </div>
  );
}
