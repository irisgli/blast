"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * The pinning, and nothing else.
 *
 * Each panel pins to the top of the viewport as it arrives and the next one scrolls up
 * over it, so the six stages stack like sheets on a desk: what a diff becomes, in the
 * order it becomes it. The panels themselves are server components handed here as
 * children, so every figure in them is in the markup before any script runs.
 *
 * Under a narrow viewport or `prefers-reduced-motion` nothing pins and the stages read
 * as a list. Before this runs, a `position: sticky` rule in the stylesheet gives the
 * desktop the same stacking without the choreography, so a slow script never leaves a
 * flat page that then jumps.
 */

const TOPBAR = 60;

export function ProofStack({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;

    element.dataset.ready = "gsap";
    const media = gsap.matchMedia();

    media.add(
      { reduce: "(prefers-reduced-motion: reduce)", wide: "(min-width: 760px)" },
      (context) => {
        const conditions = context.conditions as { reduce?: boolean; wide?: boolean };
        const pinning = conditions.wide === true && conditions.reduce !== true;

        const scope = gsap.context(() => {
          const panels = gsap.utils.toArray<HTMLElement>("[data-proof-panel]", element);
          const triggers: ScrollTrigger[] = [];

          gsap.set(panels, { zIndex: (index: number) => index + 1 });

          panels.forEach((panel, index) => {
            const inner = panel.querySelector<HTMLElement>("[data-proof-inner]");
            const rail = panel.querySelector<HTMLElement>("[data-proof-rail]");
            if (!pinning) {
              gsap.set([inner, rail].filter(Boolean), { clearProps: "all" });
              return;
            }

            // The last sheet is not pinned: it scrolls off on its own, and the section
            // after it follows rather than sliding over a pinned panel.
            if (index < panels.length - 1) {
              triggers.push(
                ScrollTrigger.create({
                  trigger: panel,
                  start: `top top+=${TOPBAR}`,
                  // Pinned until the last sheet, which is not pinned and is opaque, sits
                  // exactly over them; they let go behind it, where nothing can see.
                  endTrigger: panels[panels.length - 1] ?? panel,
                  end: `top top+=${TOPBAR}`,
                  pin: panel,
                  pinSpacing: false,
                  anticipatePin: 1,
                  refreshPriority: index,
                }),
              );
            }

            if (inner) {
              gsap.fromTo(
                inner,
                { y: 36, scale: 0.98 },
                {
                  y: 0,
                  scale: 1,
                  ease: "power3.out",
                  scrollTrigger: {
                    trigger: panel,
                    start: "top 78%",
                    end: `top ${TOPBAR + 40}px`,
                    scrub: 0.5,
                  },
                },
              );
            }

            if (rail) {
              gsap.fromTo(
                rail,
                { scaleY: 0.1, transformOrigin: "top" },
                {
                  scaleY: 1,
                  ease: "none",
                  scrollTrigger: {
                    trigger: panel,
                    start: "top 74%",
                    end: "bottom 46%",
                    scrub: true,
                  },
                },
              );
            }
          });

          return () => {
            for (const trigger of triggers) trigger.kill();
          };
        }, element);

        return () => {
          scope.revert();
        };
      },
    );

    // The panels stream in behind a boundary; the page's height moves after the triggers
    // were measured, and a pin measured against the wrong height sticks in the wrong place.
    const refresh = window.setTimeout(() => ScrollTrigger.refresh(), 200);

    return () => {
      window.clearTimeout(refresh);
      delete element.dataset.ready;
      media.revert();
    };
  }, []);

  return (
    <div ref={root} className="proof" aria-label="How a diff becomes a decision">
      {children}
    </div>
  );
}
