import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC 15M Signal Station",
  description:
    "An auth-protected Bitcoin 15-minute Kalshi advisory station with Coinbase-led probability modeling, Supabase history, and GPT-assisted reasoning.",
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
