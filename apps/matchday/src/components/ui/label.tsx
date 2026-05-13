import { cn } from "@/lib/utils";
import * as React from "react";

export function Label({
  className,
  ref,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  ref?: React.Ref<HTMLLabelElement>;
}) {
  return (
    <label
      ref={ref}
      className={cn(
        "text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
