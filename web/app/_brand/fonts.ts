import { Instrument_Serif, Inter_Tight } from "next/font/google";

// The public site's faces: a condensed display serif over a tight grotesk.
export const serif = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--font-serif", display: "swap" });
export const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const siteFonts = `${serif.variable} ${sans.variable}`;
