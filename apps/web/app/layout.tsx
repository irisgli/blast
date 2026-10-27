import type { Metadata } from "next";
import { Azeret_Mono, Schibsted_Grotesk } from "next/font/google";
import { NO_SCRIPT_MOTION_CSS } from "./components/motion";
import { SITE_URL } from "./site";
import "./globals.css";

/**
 * Two families on a proportion axis: a sharp, slightly narrow newspaper grotesk for the
 * words and a wide display monospace for the readouts. A reader can tell a measurement
 * from a sentence at a glance, which is the one thing this page's type has to do.
 */
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Azeret_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

const DESCRIPTION =
  "What a pull request costs to run, what it costs the user, and whether anyone will be able to tell if it worked — decided by code on every pull request, before anyone merges.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "blast — a pre-ship impact decision for every pull request",
    template: "%s · blast",
  },
  description: DESCRIPTION,
  openGraph: {
    title: "blast — a pre-ship impact decision for every pull request",
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-motion="">
      <head>
        {/*
          Without JavaScript nothing will ever reveal these, so they are unhidden here
          rather than left at zero opacity forever. A page that renders blank without
          scripting is not a page with an animation; it is a broken one.
        */}
        <noscript>
          <style>{NO_SCRIPT_MOTION_CSS}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
