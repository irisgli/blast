"use client";

import { useEffect } from "react";

/**
 * Sections settle into place as they are scrolled to.
 *
 * One observer for the page rather than a wrapper component per section, because the
 * effect is a property of the page and not of any component in it — and wrapping fifteen
 * sections to move each of them twelve pixels would put decoration into the markup that
 * describes the product.
 *
 * Three things keep this from costing anybody anything.
 *
 * The hidden state is rendered by the server, on `<html>`, so it applies before the first
 * paint with nothing to flash. The obvious alternative — an inline script setting the
 * attribute in the head — is what this started as, and it broke the page: React found an
 * attribute its own markup did not have, treated the tree as mismatched, and stopped
 * hydrating, so this observer never ran and every section stayed at zero opacity.
 *
 * Without JavaScript a `<noscript>` rule unhides everything, because nothing will ever
 * arrive to reveal it. A page that renders blank without scripting is not a page with an
 * animation; it is a broken one.
 *
 * `prefers-reduced-motion` disarms it entirely rather than shortening it. Someone who has
 * asked for less motion has not asked for faster motion.
 */
export function Reveal() {
  useEffect(() => {
    const root = document.documentElement;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.removeAttribute("data-reveal-armed");
      return;
    }

    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries, self) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          // Once shown, stay shown. A section that faded out on the way back up would
          // make the page feel like it was losing its place.
          self.unobserve(entry.target);
        }
      },
      /**
       * Threshold zero, deliberately.
       *
       * A ratio threshold is the obvious setting and it is wrong here: these are page
       * sections, most of them taller than the window, and a section twice the viewport
       * height tops out at an intersection ratio of about 0.5 — one of them never cleared
       * 0.04 and simply never appeared. What should trigger a reveal is the element
       * reaching the fold, which is what a shrunk root and a zero threshold say.
       */
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );

    for (const target of targets) observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}

/** Unhides everything when there is no script coming to reveal it. */
export const NO_SCRIPT_REVEAL_CSS = "[data-reveal]{opacity:1 !important;transform:none !important}";
