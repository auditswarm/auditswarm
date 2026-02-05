import { Hexagon } from "lucide-react";
import AsciiGlobe from "@/components/AsciiGlobe";
import { Button } from "@/components/ui";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
      {/* ASCII Globe */}
      <div className="absolute -right-[640px] top-1/2 -translate-y-1/2 opacity-30 pointer-events-none hidden lg:block">
        <AsciiGlobe size={120} speed={0.01} className="text-primary" />
      </div>

      <div className="max-w-7xl mx-auto px-6 w-full relative z-10">
        <div className="max-w-4xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 mb-8 animate-fade-up">
            <Hexagon className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">
              Colosseum Agent Hackathon 2026
            </span>
          </div>

          {/* Main headline */}
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.9] mb-8 animate-fade-up stagger-1">
            <span className="text-white">Crypto Tax</span>
            <br />
            <span className="text-gradient-gold">Compliance</span>
            <br />
            <span className="text-white/60">Made Simple</span>
          </h1>

          {/* Subheadline */}
          <p className="text-xl md:text-2xl text-gray-400 max-w-xl mb-12 leading-relaxed animate-fade-up stagger-2">
            AI-powered audits. Multi-jurisdiction reports.
            <span className="text-white"> Immutable on-chain attestations.</span>
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-start gap-4 animate-fade-up stagger-3">
            <Button variant="primary">Get Started</Button>
            <Button variant="secondary">View Documentation</Button>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-500">
        <span className="text-xs uppercase tracking-widest">Scroll</span>
        <div className="w-px h-8 bg-gradient-to-b from-gray-500 to-transparent" />
      </div>
    </section>
  );
}
