import type { Metadata } from "next";
import { copy } from "@/ui/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.productName,
  description: copy.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
