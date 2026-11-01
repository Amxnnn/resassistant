import type { Metadata } from "next";
import { BRAND } from "../_brand/brand";
import { DemoCall } from "./demo-call";

export const metadata: Metadata = {
  title: `Demo call · ${BRAND.name}`,
  description: "Call the demo restaurant from your browser and talk to the AI receptionist."
};

export default function DemoPage() {
  return <DemoCall />;
}
