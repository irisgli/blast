import type { Metadata } from "next";
import { Besley, Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import { SITE_URL } from "./site";
import "./globals.css";

/**
 * Two families and a monospace. A Clarendon for the verdict and the section titles, the
 * words that are the page's own; a newspaper grotesk for every sentence and every
 * figure; the monospace only where the content is code, a file, or a digest.
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
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
