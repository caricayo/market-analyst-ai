import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC 15-Minute Signal Monitor",
  description:
    "A read-only Bitcoin 15-minute Kalshi signal monitor with Coinbase one-minute candles and deterministic intraday confidence scoring.",
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
