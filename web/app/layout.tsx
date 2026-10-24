import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Saffron Table — AI Receptionist & Restaurant Dashboard",
  description: "Real-time AI voice phone receptionist dashboard for table reservations, menu intelligence, and staff management."
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
