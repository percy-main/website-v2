import { useEffect, useState } from "react";

/**
 * Returns the current Date once mounted; null until then.
 *
 * In a Vite SPA there is no SSR/hydration, but kept for parity with
 * react-doctor `rendering-hydration-mismatch-time` so future SSR can
 * be flipped on without auditing every page.
 */
export function useClientDate(): Date | null {
  const [date, setDate] = useState<Date | null>(null);
  useEffect(() => {
    // Setting state in an effect is the deliberate mechanism here: defer
    // the non-deterministic value until after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(new Date());
  }, []);
  return date;
}

/**
 * Like `useClientDate` but takes an initial value so the component
 * can render meaningfully on the first paint. Useful when a stale
 * date for one frame is acceptable.
 */
export function useClientDateWithInitial(initial: Date): Date {
  const [date, setDate] = useState<Date>(initial);
  useEffect(() => {
    // Setting state in an effect is the deliberate mechanism here: defer
    // the non-deterministic value until after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(new Date());
  }, []);
  return date;
}
