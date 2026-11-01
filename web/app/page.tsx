import type { Metadata } from "next";
import { BRAND } from "./_brand/brand";
import { siteFonts } from "./_brand/fonts";
import { SiteNav } from "./_brand/site-nav";
import { HeroStory } from "./_brand/hero-story";
import { Close, Outcomes, Rules } from "./_brand/landing";
import { SiteFooter } from "./_brand/site-footer";

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.tagline}`,
  description:
    "An AI receptionist that answers your restaurant's phone, books and changes tables, answers menu questions from your own data, and hands off to staff whenever a guest asks."
};

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
