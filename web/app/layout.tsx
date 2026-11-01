import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { siteFonts } from "./_brand/fonts";
import { THEME_BOOT, THEME_META } from "./_brand/theme-boot";
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
  // The device's appearance; the boot script repoints both once the visitor picks one on the switch.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_META.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_META.dark }
  ]
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme is set by THEME_BOOT before React hydrates, so the server's <html> never has it.
    <html lang="en" className={`${inter.variable} ${siteFonts}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
