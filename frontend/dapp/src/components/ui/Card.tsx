import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = '', hover = true }: CardProps) {
  return (
    <div
      className={`
        group relative p-8 rounded-3xl bg-surface/50 border border-white/5
        ${hover ? 'hover:border-primary/30 transition-all duration-500' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface CardIconProps {
  icon: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
}

export function CardIcon({ icon: Icon, size = 'md' }: CardIconProps) {
  const sizeStyles = {
    sm: 'w-10 h-10 rounded-xl',
    md: 'w-14 h-14 rounded-2xl',
    lg: 'w-16 h-16 rounded-2xl',
  };

  const iconSizes = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-8 h-8',
  };

  return (
    <div
      className={`
        ${sizeStyles[size]} bg-primary/10 flex items-center justify-center mb-6
        group-hover:bg-primary/20 group-hover:scale-110 transition-all
      `}
    >
      <Icon className={`${iconSizes[size]} text-primary`} />
    </div>
  );
}

interface CardTitleProps {
  children: ReactNode;
  subtitle?: string;
}

export function CardTitle({ children, subtitle }: CardTitleProps) {
  return (
    <>
      <h3 className="font-display text-2xl font-bold mb-1 group-hover:text-primary transition-colors">
        {children}
      </h3>
      {subtitle && <p className="text-white/60 text-lg mb-4">{subtitle}</p>}
    </>
  );
}

interface CardDescriptionProps {
  children: ReactNode;
}

export function CardDescription({ children }: CardDescriptionProps) {
  return (
    <p className="text-gray-500 text-sm leading-relaxed">{children}</p>
  );
}

interface CardFooterProps {
  icon: LucideIcon;
  text: string;
}

export function CardFooter({ icon: Icon, text }: CardFooterProps) {
  return (
    <div className="flex items-center gap-2 text-sm mt-4">
      <Icon className="w-4 h-4 text-primary" />
      <span className="text-gray-500">{text}</span>
    </div>
  );
}

export function CardHoverLine() {
  return (
    <div className="absolute bottom-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
  );
}

export function CardHoverGradient() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl" />
  );
}
