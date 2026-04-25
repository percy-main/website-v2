import { Label } from "@/components/ui/label";
import { campaigns } from "@percy-main/shared/marketing";
import type { ChangeEvent, FC } from "react";

const RECRUIT_SEGMENT_LABELS: Record<string, string> = {
  senior_men_cricket: "Senior men's cricket",
  senior_women_softball_cricket: "Senior women's softball cricket",
  junior_boys_cricket: "Junior boys cricket",
  junior_girls_dynamos_cricket: "Junior girls / Dynamos",
};

interface SegmentPickerProps {
  value: string;
  onChange: (segment: string) => void;
  id?: string;
  label?: string;
  className?: string;
}

/**
 * Small native `<select>` listing the recruit-2026 segments. Used by the
 * `/tell-me-about` fallback page (ticket 006) when there's no `?segment=`
 * URL param to prefill from. Reads the canonical list from the shared
 * campaigns registry so it stays in sync with the conversion-action map.
 */
export const SegmentPicker: FC<SegmentPickerProps> = ({
  value,
  onChange,
  id = "segment",
  label = "Which group are you interested in?",
  className,
}) => {
  const segments = campaigns["recruit-2026"].segments;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.currentTarget.value);
  };

  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={handleChange}
        className="border-border bg-surface text-dark ring-offset-surface flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <option value="" disabled>
          Choose one…
        </option>
        {segments.map((segment) => (
          <option key={segment} value={segment}>
            {RECRUIT_SEGMENT_LABELS[segment] ?? segment}
          </option>
        ))}
      </select>
    </div>
  );
};
