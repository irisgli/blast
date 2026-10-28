"use client";

import { useLayoutEffect } from "react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin);

/**
 * The page's motion, in one place.
 *
 * One orchestrated entrance, a smooth scroll, and reveals that fit what they reveal. The
 * entrance is the only thing that moves without being asked: the field fades up as the
 * first ring leaves the card, the mark draws its rings, the wordmark rises through a mask,
 * the lede and the actions follow, and the priced line settles in from the right. Below
 * the fold, section heads rise through line masks, paper panels rise, lists stagger, and
 * the pipeline strip draws itself. A revealed element stays revealed.
 *
 * Three rules keep this from costing anybody anything, and they are the same three the
 * previous reveal observer learned the hard way.
 *
 * The hidden state is rendered by the server, as `data-motion` on `<html>`, so it applies
 * before the first paint and there is nothing to flash. It is never set from a script
 * before hydration: React saw an attribute its markup did not have, treated the tree as
 * mismatched, and stopped hydrating, and every section below the hero stayed invisible.
 *
 * Only static elements are ever hidden. The playground, the brief, the terminal and the
 * verification block stream in behind their own boundaries and are never animated, so a
 * slow source never leaves a blank. The diff card streams in too, but inside a wrapper the
 * page renders at once; the wrapper is what the entrance moves.
 *
 * `prefers-reduced-motion` disarms all of it rather than shortening it, and without
 * JavaScript a `<noscript>` rule unhides everything. A stylesheet safety also shows
 * everything three seconds in, in case this file never runs. A page that renders blank
 * is a broken page, not an animated one.
 */

/** Unhides everything when there is no script coming to reveal it. */
export const NO_SCRIPT_MOTION_CSS =
  "[data-intro],[data-reveal]{opacity:1 !important;transform:none !important}";

const TOPBAR = 64;
const EASE = "expo.out";

/** Splits a heading into masked lines, once its typeface is the one the reader will see. */
function lines(target: Element): SplitText {
  return SplitText.create(target, { type: "lines", mask: "lines", linesClass: "line" });
}

function entrance() {
  const pick = (name: string) => document.querySelector<HTMLElement>(`[data-intro="${name}"]`);
  const field = document.querySelector<HTMLElement>(".hero .field");
  const rings = gsap.utils.toArray<SVGPathElement>(".topbar__brand path");
  const display = pick("display");
  const sub = pick("sub");
  const actions = pick("actions");
  const card = pick("card");

  const timeline = gsap.timeline({ paused: true, defaults: { ease: EASE } });

  if (field) timeline.to(field, { autoAlpha: 1, duration: 1.6, ease: "power2.out" }, 0);
  if (rings.length > 0) {
    timeline.fromTo(
      rings,
      { drawSVG: "0%" },
      { drawSVG: "100%", duration: 0.7, stagger: 0.12, ease: "power2.inOut" },
      0.05,
    );
  }

  let split: SplitText | undefined;
  if (display) {
    split = lines(display);
    gsap.set(split.lines, { yPercent: 110 });
    gsap.set(display, { autoAlpha: 1 });
    timeline.to(split.lines, { yPercent: 0, duration: 0.9, stagger: 0.09 }, 0.15);
  }

  const rest = [sub, actions].filter((node): node is HTMLElement => node !== null);
  if (rest.length > 0) {
    timeline.fromTo(
      rest,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.1 },
      0.5,
    );
  }

  if (card) {
    timeline.fromTo(
      card,
      { autoAlpha: 0, x: 40, rotationY: -7, transformPerspective: 1000, transformOrigin: "0% 50%" },
      { autoAlpha: 1, x: 0, rotationY: 0, duration: 0.95 },
      0.4,
    );
  }

  // The masks come off once the lines have landed, so a resize reflows the heading
  // naturally instead of inside line boxes measured for another width.
  timeline.eventCallback("onComplete", () => split?.revert());
  // Where the entrance began, for anyone timing the page: the hero is blank until here.
  performance.mark("blast:entrance");
  timeline.play();
}

function reveals() {
  for (const element of gsap.utils.toArray<HTMLElement>("[data-reveal]")) {
    const kind = element.dataset.reveal;
    const scrollTrigger = { trigger: element, start: "top 85%", once: true };

    if (kind === "head") {
      const title = element.querySelector(".title");
      const lede = element.querySelector(".lede");
      const split = title ? lines(title) : undefined;
      if (split) gsap.set(split.lines, { yPercent: 110 });
      if (lede) gsap.set(lede, { autoAlpha: 0, y: 10 });
      gsap.set(element, { autoAlpha: 1 });
      const timeline = gsap.timeline({
        scrollTrigger,
        defaults: { ease: EASE },
        onComplete: () => split?.revert(),
      });
      if (split) timeline.to(split.lines, { yPercent: 0, duration: 0.8, stagger: 0.08 }, 0);
      if (lede) timeline.to(lede, { autoAlpha: 1, y: 0, duration: 0.6 }, 0.25);
      continue;
    }

    if (kind === "stagger") {
      const items = Array.from(element.children);
      gsap.set(items, { autoAlpha: 0, y: 16 });
      gsap.set(element, { autoAlpha: 1 });
      gsap.to(items, {
        autoAlpha: 1,
        y: 0,
        duration: 0.6,
        ease: EASE,
        stagger: Number(element.dataset.stagger ?? 0.08),
        scrollTrigger,
      });
      continue;
    }

    if (kind === "pipe") {
      // The strip draws itself left to right, and each stage lands as the edge passes it.
      const items = Array.from(element.children);
      gsap.set(items, { autoAlpha: 0, x: -10 });
      gsap.set(element, { autoAlpha: 1, clipPath: "inset(0 100% 0 0 round 4px)" });
      gsap
        .timeline({ scrollTrigger })
        .to(
          element,
          { clipPath: "inset(0 0% 0 0 round 4px)", duration: 1, ease: "power3.inOut" },
          0,
        )
        .to(items, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.07, ease: EASE }, 0.15);
      continue;
    }

    gsap.fromTo(
      element,
      { autoAlpha: 0, y: kind === "fade" ? 0 : 18 },
      { autoAlpha: 1, y: 0, duration: kind === "fade" ? 1.2 : 0.7, ease: EASE, scrollTrigger },
    );
  }
}

export function Motion() {
  useLayoutEffect(() => {
    const root = document.documentElement;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Someone who has asked for less motion has not asked for faster motion.
      root.removeAttribute("data-motion");
      return;
    }

    // Arriving after the stylesheet's safety has already shown the page, the entrance is
    // skipped: hiding what the reader is looking at to replay it would be the flash this
    // whole arrangement exists to avoid. Scroll and the reveals below the fold still run.
    const display = document.querySelector<HTMLElement>('[data-intro="display"]');
    const late = display !== null && getComputedStyle(display).opacity === "1";
    if (late) root.removeAttribute("data-motion");
    else root.setAttribute("data-motion", "live");
    // When the script took over, and whether it was in time, for anyone timing the page.
    performance.mark("blast:motion", { detail: { late } });
    const cleanups: Array<() => void> = [() => root.setAttribute("data-motion", "")];

    const context = gsap.context(() => {
      // Smooth scroll, driven by GSAP's ticker so ScrollTrigger and Lenis agree on time.
      const lenis = new Lenis({ lerp: 0.09, autoRaf: false });
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      cleanups.push(() => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      });

      // Anchor links scroll rather than jump. Lenis's own anchor option scrolls too, but
      // does not stop the browser's jump first, so the page would leap and then ease.
      const onClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href^='#']");
        if (!anchor || anchor.hash.length < 2) return;
        // A link that opens the drawer is the drawer's, not the scroll's.
        if (anchor.hasAttribute("data-inspect")) return;
        const target = document.querySelector<HTMLElement>(anchor.hash);
        if (!target) return;
        event.preventDefault();
        lenis.scrollTo(target, { offset: -(TOPBAR + 16) });
        window.history.pushState(null, "", anchor.hash);
      };
      document.addEventListener("click", onClick);
      cleanups.push(() => document.removeEventListener("click", onClick));

      const progress = document.querySelector<HTMLElement>("[data-progress]");
      if (progress) {
        gsap.set(progress, { scaleX: 0, transformOrigin: "0% 50%" });
        const to = gsap.quickTo(progress, "scaleX", { duration: 0.15, ease: "power2.out" });
        ScrollTrigger.create({ start: 0, end: "max", onUpdate: (self) => to(self.progress) });
      }

      // The field has done its work by the time the hero leaves.
      const hero = document.querySelector<HTMLElement>(".hero");
      const backdrop = document.querySelector<HTMLElement>(".hero__backdrop");
      if (hero && backdrop) {
        gsap.to(backdrop, {
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: hero, start: "35% top", end: "bottom top", scrub: 0.5 },
        });
      }

      reveals();
    });

    // The entrance waits for the typeface, so the lines it splits are the lines the
    // reader will see; a swap mid-reveal would re-wrap the headline under the masks. The
    // faces are self-hosted and preloaded, so the wait is short and capped shorter: a
    // hero that stays blank for a font is worse than one that re-wraps once.
    let cancelled = false;
    const fonts = Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
    ]);
    // The curtain, when there is one, hands off as it lifts; the two overlap by design.
    const curtain = new Promise<void>((resolve) => {
      const loader = document.querySelector(".loader");
      if (!loader || loader.hasAttribute("data-done")) {
        resolve();
        return;
      }
      const onLift = () => resolve();
      window.addEventListener("blast:loader", onLift, { once: true });
      cleanups.push(() => window.removeEventListener("blast:loader", onLift));
      window.setTimeout(resolve, 2600);
    });
    const ready = Promise.all([fonts, curtain]);
    void ready.then(() => {
      if (cancelled || late) return;
      context.add(() => entrance());
    });
    cleanups.push(() => {
      cancelled = true;
    });

    // Streamed panels change the page's height after the triggers were measured.
    let refresh = 0;
    const landed = new MutationObserver(() => {
      window.clearTimeout(refresh);
      refresh = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    });
    landed.observe(document.body, { childList: true, subtree: true });
    const settle = window.setTimeout(() => landed.disconnect(), 8000);
    cleanups.push(() => {
      landed.disconnect();
      window.clearTimeout(settle);
      window.clearTimeout(refresh);
    });

    return () => {
      for (const cleanup of cleanups) cleanup();
      context.revert();
    };
  }, []);

  return null;
}
