import { Globe, Shield, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { TaxReportMockup } from "@/components/visuals/TaxReportMockup";

interface Feature {
  title: string;
  description: string;
  icon: LucideIcon;
}

const features: Feature[] = [
  {
    title: "Multi-Jurisdiction",
    description: "US, EU, Brazil tax laws built-in",
    icon: Globe,
  },
  {
    title: "AI-Powered",
    description: "Specialized agents per jurisdiction",
    icon: Sparkles,
  },
  {
    title: "Pay Per Use",
    description: "No subscriptions, x402 micropayments",
    icon: Zap,
  },
  {
    title: "On-Chain Proofs",
    description: "Immutable attestations on Solana",
    icon: Shield,
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="py-32 px-6 bg-surface-dark/50 relative">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left - Content */}
          <div>
            <span className="font-mono text-primary text-sm tracking-wider">
              // WHY AUDITSWARM
            </span>
            <h2 className="font-display text-4xl md:text-5xl font-bold mt-4 mb-8">
              Built for the
              <br />
              <span className="text-gradient-gold">Future of Finance</span>
            </h2>
            <p className="text-gray-400 text-lg mb-12 max-w-md">
              We combine AI intelligence with blockchain transparency. No
              subscriptions, no complexity — just compliance.
            </p>

            {/* Feature list */}
            <div className="grid grid-cols-2 gap-6">
              {features.map((feature) => (
                <FeatureItem key={feature.title} feature={feature} />
              ))}
            </div>
          </div>

          {/* Right - Report Mockup */}
          <TaxReportMockup />
        </div>
      </div>
    </section>
  );
}

function FeatureItem({ feature }: { feature: Feature }) {
  return (
    <div className="group">
      <div className="flex items-center gap-3 mb-2">
        <feature.icon className="w-5 h-5 text-primary" />
        <h4 className="font-semibold text-white group-hover:text-primary transition-colors">
          {feature.title}
        </h4>
      </div>
      <p className="text-sm text-gray-500 pl-8">{feature.description}</p>
    </div>
  );
}
