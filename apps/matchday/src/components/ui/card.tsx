import { cn } from "@/lib/utils";
import * as React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
};

export function Card({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "border-border bg-surface text-text dark:bg-surface-raised rounded-2xl border shadow-[0_1px_0_rgba(11,26,42,0.02)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1 p-4", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  ref?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <h3
      ref={ref}
      className={cn(
        "text-lg leading-tight font-semibold tracking-[-0.01em]",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.Ref<HTMLParagraphElement>;
}) {
  return (
    <p
      ref={ref}
      className={cn("text-text-secondary text-sm", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn("px-4 pb-4", className)} {...props} />;
}

export function CardFooter({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn("flex items-center px-4 pt-0 pb-4", className)}
      {...props}
    />
  );
}

/**
 * Eyebrow label used above a CardTitle. Matches the design mocks —
 * 11px, 600-weight, tracking-wide, uppercase, secondary text colour.
 */
export function CardEyebrow({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  ref?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <span
      ref={ref}
      className={cn(
        "text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase",
        className,
      )}
      {...props}
    />
  );
}
