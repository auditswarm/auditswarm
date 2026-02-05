import {
  Container,
  FileText,
  Lock,
  Shield,
  ShieldCheck,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { Card, CardHoverGradient, CardFooter } from "@/components/ui";
import { SandboxDiagram } from "@/components/visuals/SandboxDiagram";
import { SectionHeader } from "@/components/ui";

interface SecurityFeature {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  footerIcon: LucideIcon;
  footerText: string;
}

const securityFeatures: SecurityFeature[] = [
  {
    icon: Container,
    title: "Isolated Swarms",
    description: (
      <>
        Every audit spawns a fresh swarm in its own{" "}
        <span className="text-white font-mono text-sm">gVisor</span> sandboxed
        Docker container. Complete isolation between sessions.
      </>
    ),
    footerIcon: Lock,
    footerText: "No data leaks between agents",
  },
  {
    icon: UserX,
    title: "Zero KYC",
    description:
      "We never ask for your identity. Connect your wallet, get your report. That's it. Your personal information stays personal.",
    footerIcon: ShieldCheck,
    footerText: "Wallet-only authentication",
  },
  {
    icon: FileText,
    title: "You Stay in Control",
    description:
      "We generate the reports, you submit them. We digest the complexity but never act on your behalf with tax authorities.",
    footerIcon: Shield,
    footerText: "Self-custody of your data",
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="py-32 px-6 relative">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <SectionHeader
          tag="// SECURITY & PRIVACY"
          title={
            <>
              Your Data,
              <span className="text-gradient-gold"> Your Control</span>
            </>
          }
          description="We built AuditSwarm with privacy-first architecture. No tracking, no KYC, no data sharing between sessions."
          centered
        />

        {/* Security cards */}
        <div className="grid md:grid-cols-3 gap-6 mt-16">
          {securityFeatures.map((feature) => (
            <SecurityCard key={feature.title} feature={feature} />
          ))}
        </div>

        {/* Architecture visual */}
        <div className="mt-16 p-8 rounded-2xl bg-surface/30 border border-white/5">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
            <div className="lg:max-w-md">
              <h4 className="font-display text-xl font-bold mb-3">
                Sandboxed Execution
              </h4>
              <p className="text-gray-500 text-sm leading-relaxed">
                Each audit request creates an ephemeral environment that is
                destroyed after completion. Your transaction data never persists
                on our servers beyond the session.
              </p>
            </div>
            <SandboxDiagram />
          </div>
        </div>
      </div>
    </section>
  );
}

function SecurityCard({ feature }: { feature: SecurityFeature }) {
  return (
    <Card>
      <CardHoverGradient />
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-all">
          <feature.icon className="w-8 h-8 text-primary" />
        </div>
        <h3 className="font-display text-2xl font-bold mb-3 group-hover:text-primary transition-colors">
          {feature.title}
        </h3>
        <p className="text-gray-400 leading-relaxed mb-4">
          {feature.description}
        </p>
        <CardFooter icon={feature.footerIcon} text={feature.footerText} />
      </div>
    </Card>
  );
}
