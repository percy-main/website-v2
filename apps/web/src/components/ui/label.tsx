import { cn } from "@/lib/utils";
import * as React from "react";

export function Label({
  className,
  htmlFor,
  ref,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  ref?: React.Ref<HTMLLabelElement>;
}) {
  // htmlFor is destructured explicitly (rather than relying on spread)
  // so jsx-a11y/label-has-associated-control can statically see the
  // association at this primitive — every consumer passes one.
  return (
    <label
      ref={ref}
      htmlFor={htmlFor}
      className={cn(
        "text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
