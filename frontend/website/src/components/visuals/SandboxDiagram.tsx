import { FileText, Wallet } from "lucide-react";

const bees = [
  { label: "US" },
  { label: "EU" },
  { label: "BR" },
];

export function SandboxDiagram() {
  return (
    <div className="flex items-center gap-4">
      {/* User */}
      <DiagramNode icon={<Wallet className="w-6 h-6 text-gray-400" />} label="USER" />

      {/* Arrow */}
      <DiagramArrow direction="right" />

      {/* Sandbox container */}
      <div className="relative p-4 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5">
        <span className="absolute -top-2.5 left-3 px-2 bg-background text-[9px] text-primary font-mono">
          gVisor Sandbox
        </span>
        <div className="flex items-center gap-3">
          {bees.map((bee) => (
            <BeeNode key={bee.label} label={bee.label} />
          ))}
        </div>
      </div>

      {/* Arrow */}
      <DiagramArrow direction="left" />

      {/* Report output */}
      <DiagramNode
        icon={<FileText className="w-6 h-6 text-green-400" />}
        label="REPORT"
        variant="success"
      />
    </div>
  );
}

function DiagramNode({
  icon,
  label,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "success";
}) {
  const styles =
    variant === "success"
      ? "bg-green-500/10 border border-green-500/20"
      : "bg-white/5";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`w-12 h-12 rounded-xl ${styles} flex items-center justify-center`}>
        {icon}
      </div>
      <span className="text-[10px] text-gray-600 font-mono">{label}</span>
    </div>
  );
}

function DiagramArrow({ direction }: { direction: "left" | "right" }) {
  const gradient =
    direction === "right"
      ? "from-gray-600 to-primary/50"
      : "from-primary/50 to-gray-600";

  return <div className={`w-8 h-px bg-gradient-to-r ${gradient}`} />;
}

function BeeNode({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
        <span className="text-lg">🐝</span>
      </div>
      <span className="text-[8px] text-gray-500 font-mono">{label}</span>
    </div>
  );
}
