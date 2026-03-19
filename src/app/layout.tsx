import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arfor | Daily command center",
  description:
    "A polished daily command center for headlines, markets, planning, weather, and a small arcade.",
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
