import type { Metadata, Viewport } from "next";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "arfor — multi-perspective investment intelligence",
  description: "Institutional-quality investment analysis powered by multi-perspective AI evaluation",
  openGraph: {
    title: "arfor — multi-perspective investment intelligence",
    description: "Institutional-quality investment analysis powered by multi-perspective AI evaluation",
    type: "website",
    siteName: "arfor",
  },
  twitter: {
    card: "summary",
    title: "arfor — multi-perspective investment intelligence",
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
      <body className="font-mono">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
