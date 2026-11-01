import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { siteFonts } from "./_brand/fonts";
import "./globals.css";

// Inter stands in for SF Pro where the Apple system face is not installed.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "The Saffron Table · Staff",
  description: "Tonight's bookings, the menu and hours the AI receptionist speaks from, and every call it took."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000"
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${siteFonts}`}>
      <body>{children}</body>
    </html>
  );
}
