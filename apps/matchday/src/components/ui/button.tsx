import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-[-0.005em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      // tone — what the button does. Mapped from the design prompt:
      // primary (navy), destructive (red), success (green),
      // outline (subtle), ghost (no chrome), link (text-only).
      tone: {
        primary: "bg-navy text-white shadow hover:bg-navy-700",
        destructive: "bg-red text-white shadow hover:bg-red-700",
        success: "bg-green text-white shadow hover:bg-green/90",
        outline:
          "border border-border bg-transparent text-navy shadow-sm hover:bg-surface-raised dark:text-white dark:border-white/15 dark:hover:bg-white/5",
        ghost:
          "bg-transparent text-navy hover:bg-surface-raised dark:text-white dark:hover:bg-white/5",
        link: "bg-transparent text-navy-500 underline-offset-4 hover:underline",
      },
      size: {
        // Pitch-side friendly default — 44pt min tap target.
        default: "h-11 px-4 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-12 rounded-xl px-6 text-base",
        huge: "h-16 rounded-xl px-6 text-lg",
        icon: "size-11",
      },
    },
    defaultVariants: {
      tone: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  ref?: React.Ref<HTMLButtonElement>;
  /**
   * Render as a different element (e.g. wrap a react-router <Link>).
   * Mirrors shadcn's asChild pattern from apps/web.
   */
  asChild?: boolean;
}

function Button({
  className,
  tone,
  size,
  asChild,
  ref,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ tone, size, className }))}
      ref={ref}
      {...props}
    />
  );
}

export { Button, buttonVariants };
