import type { Metadata } from "next";
import { Besley, JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import { NO_SCRIPT_LOADER_CSS } from "./components/loader";
import { NO_SCRIPT_MOTION_CSS } from "./components/motion";
import { SITE_URL } from "./site";
import "./globals.css";

/**
 * Three families, one job each. A Clarendon for the words that are the page's own: the
 * wordmark, the section titles, the closing line. A newspaper grotesk for every sentence,
 * on the night and on the paper panels alike. A monospace for what is data: navigation
 * labels, readouts, digests, commands and code.
 */
const display = Besley({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

const DESCRIPTION =
  "What a pull request costs to run, what it costs the user, and whether anyone will be able to tell if it worked. Decided by rules your team wrote down, on every pull request, before anyone merges.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "blast — what a pull request costs, before you merge it",
    template: "%s · blast",
  },
  description: DESCRIPTION,
  openGraph: {
    title: "blast — what a pull request costs, before you merge it",
    description: DESCRIPTION,
    url: "/",
    siteName: "blast",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `data-motion` is rendered by the server rather than set by a script before
     * hydration. Setting it from a script is the usual way to avoid a flash and it cost
     * an afternoon here: React saw an attribute on `<html>` that its own markup did not
     * have, treated the tree as mismatched, and stopped hydrating — so the motion layer
     * never ran and every section below the hero stayed invisible. Rendering it means
     * server and client agree, and there is nothing to flash.
     */
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      data-motion=""
    >
      <head>
        {/*
          Without JavaScript nothing will ever reveal these or lift the curtain, so both
          are undone here rather than left forever. A page that renders blank without
          scripting is not a page with an animation; it is a broken one.
        */}
        <noscript>
          <style>{NO_SCRIPT_MOTION_CSS + NO_SCRIPT_LOADER_CSS}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
