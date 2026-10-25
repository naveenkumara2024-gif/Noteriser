import type { Metadata } from "next";
import localFont from "next/font/local";
import { copy } from "@/ui/copy";
import { SettingsProvider } from "@/ui/SettingsProvider";
import { NO_FLASH_SCRIPT } from "@/ui/settings";
import { AppShell } from "@/ui/shell/AppShell";
import { RunSessionProvider } from "@/ui/shell/RunSession";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.productName,
  description: copy.tagline,
};

// Atkinson Hyperlegible (SIL Open Font License, see fonts/). Offered as a "readable font"; no
// claim is made that it helps with dyslexia. Files are local so builds and pages need no network.
const readable = localFont({
  src: [
    { path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-readable",
  display: "swap",
});

// Inter (SIL Open Font License, see fonts/): the standard face, a neutral grotesque that matches the
// reference design. One variable file, latin subset, served from our own origin.
const inter = localFont({
  src: [{ path: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The head script sets display attributes on <html> before hydration, so they differ from the server HTML.
    <html lang="en" className={`${readable.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant string we build, not user input
          dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }}
        />
      </head>
      <body className="min-h-screen">
        <SettingsProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
          >
            {copy.skipToContent}
          </a>
          <RunSessionProvider>
            {/* Until accounts exist (Stage 11) everyone is a guest with no sign-in. */}
            <AppShell viewer={{ kind: "guest-no-auth" }}>{children}</AppShell>
          </RunSessionProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
