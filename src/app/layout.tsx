import type { Metadata } from "next";
import Link from "next/link";
import { copy } from "@/ui/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.productName,
  description: copy.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          {copy.skipToContent}
        </a>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
            <Link href="/" className="text-lg font-semibold">
              {copy.productName}
            </Link>
            {/* Invariant 6: persistent, on every page, in words. */}
            <p role="note" className="text-sm text-muted">
              {copy.trustNotice}
            </p>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none">
          {children}
        </main>
      </body>
    </html>
  );
}
