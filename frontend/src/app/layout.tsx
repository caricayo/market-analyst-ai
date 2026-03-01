import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "arfour — multi-perspective investment intelligence",
  description: "Institutional-quality investment analysis powered by multi-perspective AI evaluation",
  openGraph: {
    title: "arfour — multi-perspective investment intelligence",
    description: "Institutional-quality investment analysis powered by multi-perspective AI evaluation",
    type: "website",
    siteName: "arfour",
  },
  twitter: {
    card: "summary",
    title: "arfour — multi-perspective investment intelligence",
    description: "Institutional-quality investment analysis powered by multi-perspective AI evaluation",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${jetbrains.variable} font-mono`}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
