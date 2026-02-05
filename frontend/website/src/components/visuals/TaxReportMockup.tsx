import { FileText, Shield, Wallet } from "lucide-react";
import { Logo } from "@/components/Logo";

const wallets = ["7xKp...9mNq", "DYw8...jC4k", "9Bzx...2wPm"];

const categories = [
  { label: "Trades", count: 847 },
  { label: "DeFi", count: 312 },
  { label: "Staking", count: 64 },
  { label: "Airdrops", count: 24 },
];

const gains = [
  { label: "Short-term", value: "+$12,450", color: "text-green-400" },
  { label: "Long-term", value: "+$8,230", color: "text-green-400" },
  { label: "Losses", value: "-$3,120", color: "text-red-400" },
];

export function TaxReportMockup() {
  return (
    <div className="relative">
      <div className="rounded-2xl bg-surface border border-white/10 overflow-hidden">
        {/* Report Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Logo size={18} className="text-primary" />
            <span className="font-mono text-[10px] text-gray-500">
              TAX REPORT
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">🇺🇸</span>
            <span className="font-mono text-[10px] text-white">2025</span>
          </div>
        </div>

        {/* Report Content */}
        <div className="p-4 space-y-3">
          {/* Audit Scope */}
          <div className="grid grid-cols-3 gap-2">
            <StatBox value="3" label="Wallets" />
            <StatBox value="1,247" label="Transactions" />
            <StatBox value="$47.2k" label="Volume" highlight />
          </div>

          {/* Wallets List */}
          <div className="flex items-center gap-1 text-[9px]">
            <Wallet className="w-3 h-3 text-gray-500" />
            {wallets.map((wallet, i) => (
              <span key={wallet}>
                <span className="font-mono text-gray-400">{wallet}</span>
                {i < wallets.length - 1 && (
                  <span className="text-gray-600 mx-1">•</span>
                )}
              </span>
            ))}
          </div>

          {/* Transaction Categories */}
          <div>
            <span className="text-[8px] text-gray-500 uppercase tracking-wider">
              By Category
            </span>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5">
              {categories.map((cat) => (
                <div
                  key={cat.label}
                  className="bg-white/5 rounded px-2 py-1.5 text-center"
                >
                  <span className="block text-sm font-bold text-white">
                    {cat.count}
                  </span>
                  <span className="text-[7px] text-gray-500">{cat.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Capital Gains */}
          <div className="bg-white/5 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] text-gray-500 uppercase tracking-wider">
                Capital Gains
              </span>
              <span className="px-1.5 py-0.5 bg-primary/20 text-primary rounded font-mono text-[8px]">
                HIFO
              </span>
            </div>
            <div className="space-y-1.5">
              {gains.map((gain) => (
                <div
                  key={gain.label}
                  className="flex justify-between items-center"
                >
                  <span className="text-[10px] text-gray-400">{gain.label}</span>
                  <span className={`font-mono text-xs ${gain.color}`}>
                    {gain.value}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-1.5 border-t border-white/10">
                <span className="text-xs font-semibold text-white">
                  Net Gain
                </span>
                <span className="font-mono text-base font-bold text-primary">
                  $17,560
                </span>
              </div>
            </div>
          </div>

          {/* Forms & Attestation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-gray-500" />
              <span className="text-[9px] text-gray-400">Form 8949</span>
              <span className="text-gray-600">•</span>
              <span className="text-[9px] text-gray-400">Schedule D</span>
            </div>
            <div className="flex items-center gap-1 bg-green-500/10 border border-green-500/20 rounded px-2 py-1">
              <Shield className="w-3 h-3 text-green-400" />
              <span className="text-[9px] text-green-400">Attested</span>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative glow */}
      <div className="absolute -inset-4 bg-primary/5 rounded-3xl blur-2xl -z-10" />
    </div>
  );
}

function StatBox({
  value,
  label,
  highlight,
}: {
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-white/5 rounded-lg p-2 text-center">
      <span
        className={`block text-xl font-bold ${highlight ? "text-primary" : "text-white"}`}
      >
        {value}
      </span>
      <span className="text-[8px] text-gray-500 uppercase">{label}</span>
    </div>
  );
}
