import type { Metadata } from "next";
import { BRAND } from "../_brand/brand";
import { SignIn } from "./sign-in";

export const metadata: Metadata = {
  title: `Sign in · ${BRAND.name}`,
  description: "Staff sign-in for the Resassistant dashboard."
};

export default function LoginPage() {
  return <SignIn />;
}
