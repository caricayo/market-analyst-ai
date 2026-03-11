import type { Metadata } from "next";
import StoryParallax from "@/components/story-parallax";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Last Lumenweaver",
  description: "A Lumenweld story presented as an immersive reading experience.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <StoryParallax />
        {children}
      </body>
    </html>
  );
}
