import { useInView } from "@/hooks/use-in-view.js";
import { cn } from "@/lib/utils.js";
import type { CSSProperties, ElementType, ReactNode } from "react";

interface RisoHeadingProps {
  /** The text to print in two off-register ink layers. */
  children: ReactNode;
  /** Element to render as (h1/h2/span/...). Defaults to a span. */
  as?: ElementType;
  /** Front ink colour (CSS value). Defaults to navy. */
  front?: string;
  /** Back ink colour (CSS value). Defaults to orange. */
  back?: string;
  /** Blend mode between the inks and paper. "multiply" overprints. */
  blend?: "multiply" | "normal";
  className?: string;
}

/**
 * The riso heading mechanism: the same text stacked as two mis-registered ink
 * layers over a hidden sizing layer, settling into closer registration as it
 * scrolls into view (and nudging on hover). The visible text is the hidden base
 * layer — the printed layers are aria-hidden so screen readers read it once.
 */
export function RisoHeading({
  children,
  as: Tag = "span",
  front,
  back,
  blend = "multiply",
  className,
}: RisoHeadingProps) {
  const { ref, inView } = useInView();

  const style = {
    ...(front ? { "--fc-riso-front": front } : {}),
    ...(back ? { "--fc-riso-back": back } : {}),
    "--fc-riso-blend": blend,
  } as CSSProperties;

  return (
    <Tag
      ref={ref}
      className={cn("fc-riso", inView && "in", className)}
      style={style}
    >
      <span className="fc-riso-base">{children}</span>
      <span className="fc-riso-back" aria-hidden="true">
        {children}
      </span>
      <span className="fc-riso-front" aria-hidden="true">
        {children}
      </span>
    </Tag>
  );
}
