import { type ReactNode } from 'react';

interface HoneycombBackgroundProps {
  children: ReactNode;
  className?: string;
}

export function HoneycombBackground({ children, className = '' }: HoneycombBackgroundProps) {
  return (
    <div className={`relative min-h-screen ${className}`}>
      {/* Honeycomb pattern */}
      <div className="fixed inset-0 honeycomb-bg pointer-events-none" />

      {/* Gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background/95 to-background pointer-events-none" />

      {/* Radial glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
