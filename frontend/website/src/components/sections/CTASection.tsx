import { Button } from "@/components/ui";
import { HexagonAnimation } from "@/components/visuals/HexagonAnimation";

export function CTASection() {
  return (
    <section className="py-32 px-6 relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 honeycomb-bg opacity-30" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="rounded-3xl border border-white/10 bg-surface/30 backdrop-blur-sm p-10 md:p-14 relative overflow-hidden">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            {/* Left - Content */}
            <div>
              <span className="font-mono text-primary text-sm tracking-wider">
                // GET STARTED
              </span>

              <h2 className="font-display text-4xl md:text-5xl font-bold mt-4 mb-6">
                Ready to join
                <br />
                <span className="text-gradient-gold">the swarm?</span>
              </h2>

              <p className="text-lg text-gray-400 mb-8">
                Connect your wallet, let our AI analyze your transactions, and
                get compliant in minutes.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-4">
                <Button variant="primary">Launch App</Button>
                <Button variant="ghost">Read the Docs</Button>
              </div>
            </div>

            {/* Right - Visual */}
            <HexagonAnimation />
          </div>
        </div>
      </div>
    </section>
  );
}
