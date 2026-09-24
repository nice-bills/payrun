import type { Metadata } from "next";
import { Caveat, Courier_Prime, Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const courier = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-courier" });
const caveat = Caveat({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-caveat" });

export const metadata: Metadata = {
  title: "Payrun",
  description: "Write your contractor payment policy once. Payrun applies it to every invoice with SERV Reasoning and enforces it on the wallet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${courier.variable} ${caveat.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
