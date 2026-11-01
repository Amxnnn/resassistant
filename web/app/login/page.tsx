import type { Metadata, Viewport } from "next";
import { BRAND } from "../_brand/brand";
import { SignIn } from "./sign-in";

export const metadata: Metadata = {
  title: `Sign in · ${BRAND.name}`,
  description: "Staff sign-in for the Resassistant dashboard."
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function LoginPage() {
  return <SignIn />;
}
