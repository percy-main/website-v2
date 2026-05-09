import { cn } from "@/lib/utils";
import * as React from "react";

function Textarea({
  className,
  ref,
  ...props
}: React.ComponentProps<"textarea"> & {
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      className={cn(
        "border-border bg-surface text-dark ring-offset-surface placeholder:text-muted flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Textarea };
