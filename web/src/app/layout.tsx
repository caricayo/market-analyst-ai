import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC 15-Minute Kalshi Bot",
  description:
    "A Bitcoin 15-minute Kalshi trading console with Coinbase one-minute candles, timing-risk gates, AI synthesis, and optional server-side execution.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
