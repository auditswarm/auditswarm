"use client";

import { Navbar, Footer } from "@/components/layout";
import {
  HeroSection,
  ProcessSection,
  FeaturesSection,
  SecuritySection,
  CTASection,
} from "@/components/sections";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background honeycomb-bg relative">
      {/* Gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background/95 to-background pointer-events-none" />

      <Navbar />
      <HeroSection />
      <ProcessSection />
      <FeaturesSection />
      <SecuritySection />
      <CTASection />
      <Footer />
    </div>
  );
}
