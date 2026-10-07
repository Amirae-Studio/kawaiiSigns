import type { Metadata } from "next";
import { Fredoka } from "next/font/google";
import "./globals.css";

const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka" });
export const metadata: Metadata = { title: "Kawaii 3D · image to 3D sign" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body className={`${fredoka.variable} font-[family-name:var(--font-fredoka)] antialiased`}>{children}</body></html>
  );
}
