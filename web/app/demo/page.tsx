import type { Metadata, Viewport } from "next";
import { BRAND } from "../_brand/brand";
import { DemoCall } from "./demo-call";

export const metadata: Metadata = {
  title: `Demo call · ${BRAND.name}`,
  description: "Call the demo restaurant from your browser and talk to the AI receptionist."
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function DemoPage() {
  return <DemoCall />;
}
