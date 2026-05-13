import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * Unified status pill used across availability, donations, expenses,
 * matchday state. Per the design directive: one pill system, not bespoke
 * per feature.
 *
 *   tone:  navy (info), success (available/paid), warning (pending/draft),
 *          danger (unavailable/overdue/no-show), neutral (no response / closed)
 *   dot:   prefix with a 6px filled dot for emphasis
 */
const pillStyles = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold tracking-[0.02em] leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-border text-text-secondary",
        navy: "bg-info-bg text-navy dark:text-white",
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface StatusPillProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillStyles> {
  dot?: boolean;
}

export function StatusPill({
  tone,
  dot,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span className={cn(pillStyles({ tone }), className)} {...props}>
      {dot && (
        <span aria-hidden className="size-[6px] rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}
