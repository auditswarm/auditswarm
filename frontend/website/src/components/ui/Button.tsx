import { ArrowRight, ChevronRight } from "lucide-react";
import { type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  href?: string;
  className?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "group flex items-center gap-3 px-8 py-4 bg-primary text-background font-semibold rounded-full hover:bg-primary-400 transition-all hover:scale-105 glow-sm",
  secondary:
    "flex items-center gap-2 px-8 py-4 text-white font-medium hover:text-primary transition-colors",
  ghost:
    "flex items-center gap-2 px-6 py-4 text-gray-400 font-medium hover:text-white transition-colors",
};

function ButtonIcon({ variant }: { variant: ButtonVariant }) {
  if (variant === "primary") {
    return (
      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
    );
  }
  return <ChevronRight className="w-4 h-4" />;
}

export function Button({
  children,
  variant = "primary",
  href,
  className = "",
}: ButtonProps) {
  const styles = `${variantStyles[variant]} ${className}`;

  if (href) {
    return (
      <a href={href} className={styles}>
        <span>{children}</span>
        <ButtonIcon variant={variant} />
      </a>
    );
  }

  return (
    <button className={styles}>
      {children}
      <ButtonIcon variant={variant} />
    </button>
  );
}
