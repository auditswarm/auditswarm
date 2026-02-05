import { type ReactNode } from "react";

interface SectionHeaderProps {
  tag: string;
  title: ReactNode;
  description?: string;
  centered?: boolean;
}

export function SectionHeader({
  tag,
  title,
  description,
  centered = false,
}: SectionHeaderProps) {
  return (
    <div className={centered ? "text-center" : ""}>
      <span className="font-mono text-primary text-sm tracking-wider">
        {tag}
      </span>
      <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mt-4 mb-6">
        {title}
      </h2>
      {description && (
        <p
          className={`text-gray-400 text-lg ${centered ? "max-w-2xl mx-auto" : "max-w-md"}`}
        >
          {description}
        </p>
      )}
    </div>
  );
}
