import { Hexagon } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';

const concentricHexagons = [
  { size: 'w-80 h-80', opacity: 'text-primary/10', animation: 'animate-hex-1' },
  { size: 'w-64 h-64', opacity: 'text-primary/15', animation: 'animate-hex-2' },
  { size: 'w-48 h-48', opacity: 'text-primary/25', animation: 'animate-hex-3' },
  {
    size: 'w-32 h-32',
    opacity: 'text-primary/40',
    animation: 'animate-hex-4',
    strokeWidth: 1.5,
  },
];

const floatingHexagons = [
  {
    size: 'w-24 h-24',
    position: '-top-6 right-0',
    opacity: 'text-primary/10',
    animation: 'animate-hex-float-1',
  },
  {
    size: 'w-14 h-14',
    position: 'bottom-0 -right-4',
    opacity: 'text-primary/15',
    animation: 'animate-hex-float-2',
  },
  {
    size: 'w-20 h-20',
    position: 'top-2 -left-8',
    opacity: 'text-primary/10',
    animation: 'animate-hex-float-3',
  },
  {
    size: 'w-12 h-12',
    position: 'bottom-12 left-4',
    opacity: 'text-primary/20',
    animation: 'animate-hex-float-4',
  },
];

export function HexagonAnimation() {
  return (
    <div className="hidden lg:flex items-center justify-center relative h-80">
      <div className="relative w-80 h-80 flex items-center justify-center">
        {concentricHexagons.map((hex, i) => (
          <Hexagon
            key={i}
            className={`${hex.size} ${hex.opacity} absolute top-1/2 left-1/2 ${hex.animation}`}
            strokeWidth={hex.strokeWidth ?? 1}
          />
        ))}
        <div className="animate-hex-center">
          <Logo size={56} className="text-primary" />
        </div>
      </div>

      {floatingHexagons.map((hex, i) => (
        <Hexagon
          key={i}
          className={`${hex.size} ${hex.opacity} absolute ${hex.position} ${hex.animation}`}
          strokeWidth={1}
        />
      ))}
    </div>
  );
}
