import type { Metadata } from "next";
import { Saira } from "next/font/google";
import "./globals.css";

const saira = Saira({ subsets: ["latin"], axes: ["wdth"], variable: "--font-saira" });

export const metadata: Metadata = {
  title: "Pitwall",
  description: "Live Formula 1 timing, track map and race replay from OpenF1.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${saira.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
