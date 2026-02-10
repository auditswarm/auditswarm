'use client';

interface ProgressBarProps {
  currentStep: number;
  steps: string[];
}

export function ProgressBar({ currentStep, steps }: ProgressBarProps) {
  return (
    <div className="w-full">
      {/* Desktop: segments + labels */}
      <div className="hidden sm:block">
        <div className="flex gap-2 mb-3">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                i <= currentStep
                  ? 'bg-primary'
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {steps.map((label, i) => (
            <span
              key={i}
              className={`font-mono text-xs transition-colors ${
                i <= currentStep ? 'text-primary' : 'text-gray-600'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Mobile: dots only */}
      <div className="flex sm:hidden justify-center gap-3">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all duration-500 ${
              i <= currentStep
                ? 'bg-primary scale-125'
                : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
