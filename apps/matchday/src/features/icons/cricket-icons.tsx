/** Small cricket-specific glyphs that lucide doesn't ship. */

export function CrownIcon({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
    </svg>
  );
}

export function GloveIcon({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 8c1-2 4-3 7-3s6 1 7 3v8c0 2-1 4-3 4s-2-1-3-2c0-1-1-1-1-1s-1 0-1 1c-1 1-1 2-3 2s-3-2-3-4V8z" />
    </svg>
  );
}
