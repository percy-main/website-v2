import { formatInTimeZone } from "date-fns-tz";
import type { ReactNode } from "react";
import { Link } from "react-router";

/** One row of the fixture strip. */
export interface FixtureStripItem {
  /** Stable key + used for nothing else. */
  id: string;
  /** Where the row links to. */
  href: string;
  /** ISO datetime; the date block derives from it unless `lead` overrides it. */
  when: string;
  /** The headline of the row, e.g. "1st XI vs Tynemouth CC". */
  title: ReactNode;
  /** Secondary line under the title, e.g. "Match · 2:00 PM". Omitted if absent. */
  meta?: ReactNode;
  /** Right-hand stamp, e.g. "Home" / "Away" / "Event". */
  tag: ReactNode;
  /**
   * Overrides the left block. The default is the date derived from `when`;
   * pass e.g. a time when rows are already grouped under a date heading, so
   * the date is not printed twice.
   */
  lead?: ReactNode;
}

/**
 * The poster fixture strip: a date block, the fixture, and a Home/Away tag,
 * with an orange (or navy, on an orange plate) sweep on hover. Extracted from
 * the homepage "What's On" so every fixture list across the site reads in one
 * voice. Renders navy-on-paper by default; drop it inside a `Plate variant=
 * "orange"` and the `.fc-plate--orange .fc-frow` rules invert it to cream.
 */
export function FixtureStrip({ items }: { items: FixtureStripItem[] }) {
  return (
    <div className="fc-fixtures">
      {items.map((item) => (
        <Link key={item.id} to={item.href} className="fc-frow">
          <div className="fc-frow-date">
            {item.lead ?? (
              <>
                {formatInTimeZone(
                  new Date(item.when),
                  "Europe/London",
                  "EEE dd",
                )}
                <br />
                {formatInTimeZone(new Date(item.when), "Europe/London", "MMM")}
              </>
            )}
          </div>
          <div>
            <div className="fc-frow-opp">{item.title}</div>
            {item.meta != null && (
              <div className="fc-frow-meta">{item.meta}</div>
            )}
          </div>
          <div className="fc-frow-tag">{item.tag}</div>
        </Link>
      ))}
    </div>
  );
}
