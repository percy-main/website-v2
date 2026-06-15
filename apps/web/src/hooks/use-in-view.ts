import { useEffect, useRef, useState } from "react";

/**
 * Adds a one-shot "has entered the viewport" flag to an element, used to drive
 * the First-Class theme's reveal animations (riso layers settling, plates
 * fading up). Once seen, it stays seen — no re-hiding on scroll-out — and the
 * observer disconnects so it never fires twice.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  rootMargin = "0px 0px -10% 0px",
): { ref: React.RefObject<T | null>; inView: boolean } {
  const ref = useRef<T>(null);
  // Fail open: where there is no IntersectionObserver, start revealed so
  // content is never stuck hidden (also keeps setState out of the effect body).
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.14, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
