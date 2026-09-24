import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NO_SCRIPT_REVEAL_CSS, Reveal } from "./components/reveal";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Impact · blast",
  description:
    "What a pull request costs to run, what it costs the user, and whether anyone will be able to tell if it worked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `data-reveal-armed` is rendered by the server rather than set by a script before
     * hydration. Setting it from a script is the usual way to avoid a flash and it cost
     * an afternoon here: React saw an attribute on `<html>` that its own markup did not
     * have, treated the tree as mismatched, and stopped hydrating — so the observer never
     * ran and every section below the hero stayed invisible. Rendering it means server
     * and client agree, and there is nothing to flash.
     */
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-reveal-armed="">
      <head>
        {/*
          Without JavaScript nothing will ever reveal these, so they are unhidden here
          rather than left at zero opacity forever. A page that renders blank without
          scripting is not a page with an animation; it is a broken one.
        */}
        <noscript>
          <style>{NO_SCRIPT_REVEAL_CSS}</style>
        </noscript>
      </head>
      <body>
        {children}
        <Reveal />
      </body>
    </html>
  );
}
