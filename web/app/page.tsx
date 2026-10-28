import type { Metadata, Viewport } from "next";
import { BRAND } from "./_brand/brand";
import { siteFonts } from "./_brand/fonts";
import { SiteNav } from "./_brand/site-nav";
import { HeroStory } from "./_brand/hero-story";
import { Close, Outcomes, Rules, SiteFooter } from "./_brand/landing";

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.tagline}`,
  description:
    "An AI receptionist that answers your restaurant's phone, books and changes tables, answers menu questions from your own data, and hands off to staff whenever a guest asks."
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function LandingPage() {
  return (
    <div className={`site ${siteFonts}`}>
      <SiteNav page="home" />
      <main>
        <HeroStory />
        <Outcomes />
        <Rules />
        <Close />
      </main>
      <SiteFooter />
    </div>
  );
}
