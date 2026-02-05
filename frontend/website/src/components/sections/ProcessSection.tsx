import { Bot, FileText, Shield, Wallet, type LucideIcon } from "lucide-react";
import {
  Card,
  CardIcon,
  CardTitle,
  CardDescription,
  CardHoverLine,
} from "@/components/ui";

interface Step {
  number: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
}

const steps: Step[] = [
  {
    number: "01",
    title: "Connect",
    subtitle: "Your Wallet",
    description:
      "Securely link your wallets using Sign-In with Solana. We support all major providers.",
    icon: Wallet,
  },
  {
    number: "02",
    title: "Analyze",
    subtitle: "With AI Swarm",
    description:
      "Our specialized AI agents analyze every transaction with jurisdiction-specific knowledge.",
    icon: Bot,
  },
  {
    number: "03",
    title: "Generate",
    subtitle: "Tax Reports",
    description:
      "Download professional reports formatted for US, EU, or Brazil tax requirements.",
    icon: FileText,
  },
  {
    number: "04",
    title: "Attest",
    subtitle: "On-Chain",
    description:
      "Create immutable compliance proofs that DeFi protocols can verify instantly.",
    icon: Shield,
  },
];

export function ProcessSection() {
  return (
    <section id="process" className="py-32 px-6 relative">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-20">
          <div>
            <span className="font-mono text-primary text-sm tracking-wider">
              // HOW IT WORKS
            </span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mt-4">
              Four Steps to
              <br />
              <span className="text-gradient-gold">Compliance</span>
            </h2>
          </div>
          <p className="text-gray-400 max-w-md text-lg">
            From wallet connection to immutable proof — our AI swarm handles the
            complexity.
          </p>
        </div>

        {/* Steps */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({ step }: { step: Step }) {
  return (
    <Card className="hover:-translate-y-2">
      {/* Number */}
      <span className="font-mono text-7xl font-bold text-primary/10 group-hover:text-primary/20 transition-colors absolute top-4 right-6">
        {step.number}
      </span>

      <CardIcon icon={step.icon} />
      <CardTitle subtitle={step.subtitle}>{step.title}</CardTitle>
      <CardDescription>{step.description}</CardDescription>
      <CardHoverLine />
    </Card>
  );
}
