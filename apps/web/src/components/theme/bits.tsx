import { useInView } from "@/hooks/use-in-view.js";
import { cn } from "@/lib/utils.js";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { RisoHeading } from "./riso-heading.js";

/** A small uppercase, heavily letterspaced label — the "No. 03" kicker. */
export function Kicker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("fc-kicker", className)}>{children}</div>;
}

/**
 * Section masthead: an oversized riso heading paired with a right-aligned note,
 * sitting above a section's content.
 */
export function SectionMast({
  title,
  note,
  front,
  back,
  blend,
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  front?: string;
  back?: string;
  blend?: "multiply" | "normal";
  className?: string;
}) {
  return (
    <div className={cn("fc-mast", className)}>
      <RisoHeading as="h2" front={front} back={back} blend={blend}>
        {title}
      </RisoHeading>
      {note && <div className="fc-mast-note">{note}</div>}
    </div>
  );
}

/** A rotated, stamped CTA. Renders an internal Link or an external anchor. */
export function StampLink({
  to,
  href,
  children,
  className,
}: {
  to?: string;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  if (href) {
    return (
      <a className={cn("fc-stamp", className)} href={href}>
        {children}
      </a>
    );
  }
  return (
    <Link className={cn("fc-stamp", className)} to={to ?? "#"}>
      {children}
    </Link>
  );
}

/**
 * The stamped CTA as a real <button> — the action-triggering twin of
 * StampLink, for form submits and onClick handlers. `size="sm"` is the
 * tighter form-field size; `variant="navy"` swaps the orange ink for navy.
 */
export function StampButton({
  type = "button",
  variant,
  size,
  disabled,
  onClick,
  children,
  className,
}: {
  type?: "button" | "submit" | "reset";
  variant?: "navy";
  size?: "sm";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "fc-stamp",
        variant === "navy" && "fc-stamp--navy",
        size === "sm" && "fc-stamp--sm",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Fades + lifts its children once they scroll into view. */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("fc-rv", inView && "in", className)}>
      {children}
    </div>
  );
}
