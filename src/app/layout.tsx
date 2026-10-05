import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HI Digital Team", template: "%s · HI Digital Team" },
  description: "Internal dashboard for HI Digital Solution LLP",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
