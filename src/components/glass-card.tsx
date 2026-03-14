import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = HTMLAttributes<HTMLElement> & {
  children: React.ReactNode;
};

export function GlassCard({ children, className, ...props }: GlassCardProps) {
  return (
    <section
      {...props}
      className={cn(
        "glass-panel relative overflow-hidden rounded-[30px] border border-[var(--panel-border)]",
        className,
      )}
    >
      {children}
    </section>
  );
}
