'use client';

import { JURISDICTIONS } from '@/lib/constants';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';

interface RegionSelectStepProps {
  selectedJurisdiction: string | null;
  onSelect: (code: string) => void;
}

export function RegionSelectStep({ selectedJurisdiction, onSelect }: RegionSelectStepProps) {
  const active = JURISDICTIONS.filter((j) => j.active);
  const comingSoon = JURISDICTIONS.filter((j) => !j.active);

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-10">
        <span className="font-mono text-[11px] text-primary uppercase tracking-wider">
          // select your jurisdiction
        </span>
        <h2 className="font-display text-2xl font-bold mt-2 mb-2">
          Where do you file taxes?
        </h2>
        <p className="text-sm text-gray-500">
          Choose your primary jurisdiction. This sets which AI agent handles your audit.
        </p>
      </div>

      {/* Active jurisdictions */}
      <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3">
        {active.map((j, i) => {
          const isSelected = selectedJurisdiction === j.code;
          return (
            <motion.button
              key={j.code}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.25 }}
              onClick={() => onSelect(j.code)}
              className={`
                relative text-left p-5 rounded-xl border-2 transition-all duration-200
                ${
                  isSelected
                    ? 'border-primary bg-primary/[0.06]'
                    : 'border-transparent bg-white/[0.03] hover:bg-white/[0.05]'
                }
              `}
            >
              {/* Selection indicator */}
              <div
                className={`
                  absolute top-4 right-4 w-5 h-5 rounded-full flex items-center justify-center transition-all
                  ${
                    isSelected
                      ? 'bg-primary'
                      : 'border border-white/10'
                  }
                `}
              >
                {isSelected && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
              </div>

              {/* Flag + name */}
              <span className="text-3xl block mb-3">{j.flag}</span>
              <h3 className="text-sm font-semibold mb-0.5">{j.name}</h3>
              <span className="font-mono text-[10px] text-gray-600 block mb-3">{j.code}</span>

              {/* Description */}
              <p className="text-[11px] text-gray-500 leading-relaxed mb-4">{j.description}</p>

              {/* Report formats */}
              <div className="flex flex-wrap gap-1">
                {j.reportFormats.map((fmt) => (
                  <span
                    key={fmt}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                      isSelected
                        ? 'bg-primary/15 text-primary'
                        : 'bg-white/[0.05] text-gray-600'
                    }`}
                  >
                    {fmt}
                  </span>
                ))}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Coming soon */}
      <div className="max-w-3xl mx-auto mt-8 pt-5 border-t border-white/[0.04] flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span className="text-[10px] font-mono text-gray-700 uppercase tracking-wider">
          Coming soon:
        </span>
        {comingSoon.map((j) => (
          <span key={j.code} className="text-[11px] text-gray-600 opacity-50">
            {j.flag} {j.name}
          </span>
        ))}
      </div>
    </div>
  );
}
