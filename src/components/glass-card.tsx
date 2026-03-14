import { cn } from "@/lib/utils";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
};

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <section
      className={cn(
        "glass-panel relative overflow-hidden rounded-[30px] border border-[var(--panel-border)]",
        className,
      )}
    >
      {children}
    </section>
  );
}
