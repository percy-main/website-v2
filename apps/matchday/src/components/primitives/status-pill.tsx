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
  "inline-flex items-center gap-1 rounded-full font-semibold tracking-[0.02em] leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-border text-text-secondary",
        navy: "bg-info-bg text-navy dark:text-white",
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
      },
      size: {
        // Default — fits inside a row, alongside other text.
        default: "px-2 py-[3px] text-[11px]",
        // Result badges — bigger type, bigger pill, room for a score
        // description like "Won by 4 wickets" without feeling cramped.
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
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
  size,
  dot,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span className={cn(pillStyles({ tone, size }), className)} {...props}>
      {dot && (
        <span aria-hidden className="size-[6px] rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}
