import { LeadForm } from "@/components/marketing/lead-form.js";
import {
  FormSection,
  ReassuranceList,
  RecruitHero,
  TrialIsFree,
  type ReassuranceItem,
} from "@/components/marketing/recruit-page-sections.js";
import { SegmentPicker } from "@/components/marketing/segment-picker.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useState } from "react";
import { Link } from "react-router";

const REASSURANCE: readonly ReassuranceItem[] = [
  {
    heading: "Who it's for",
    body: "Adults and juniors of all experience levels. Pick the group that fits — men's hardball, women's softball, junior boys, or girls' Dynamos.",
  },
  {
    heading: "When training happens",
    body: "Tuesday evenings, 6:30pm–8pm during the season at our ground on St. Johns Terrace, North Shields, NE29 6HS. Some junior age groups also train at weekends.",
  },
  {
    heading: "What to bring",
    body: "Nothing. We'll sort kit for your first session — bat, pads, helmet for juniors. Just wear comfortable sportswear and trainers.",
  },
  {
    heading: "What happens next",
    body: "Submit the form and someone from the club will be in touch within one working day to agree a date. Then you turn up.",
  },
];

const SEGMENT_LINKS: ReadonlyArray<{
  segment: string;
  label: string;
  description: string;
  href: string;
}> = [
  {
    segment: "senior_men_cricket",
    label: "Men's Cricket",
    description: "Hardball cricket for men 18+, all experience levels.",
    href: "/tell-me-about/mens-cricket",
  },
  {
    segment: "senior_women_softball_cricket",
    label: "Women's Softball Cricket",
    description: "A friendlier format of the game — perfect for beginners.",
    href: "/tell-me-about/womens-cricket",
  },
  {
    segment: "junior_boys_cricket",
    label: "Junior Boys Cricket",
    description: "Coaching for boys in school years 1–11.",
    href: "/tell-me-about/junior-boys",
  },
  {
    segment: "junior_girls_dynamos_cricket",
    label: "Junior Girls — Dynamos",
    description: "ECB Dynamos cricket for girls aged 8–11.",
    href: "/tell-me-about/junior-girls",
  },
];

function variantForSegment(segment: string): "adult" | "junior" {
  return segment.startsWith("junior_") ? "junior" : "adult";
}

export function Component() {
  useDocumentMeta(
    "Try a Session — Percy Main Community Sports Club",
    "Free trial cricket sessions at Percy Main, North Tyneside. Men's, women's, junior boys, and Dynamos girls' cricket. We'll be in touch within one working day.",
  );

  const [segment, setSegment] = useState<string>("");
  const variant = segment.length > 0 ? variantForSegment(segment) : null;

  return (
    <>
      <RecruitHero
        eyebrow="Recruit 2026"
        title="Try a session at Percy Main"
        description="Cricket at Percy Main Community Sports Club, North Shields. Pick the group that fits and we'll get back to you within one working day."
        imageAlt="Percy Main Cricket Club"
      />

      <ReassuranceList items={REASSURANCE} />
      <TrialIsFree />

      {/* Dedicated segment links — secondary navigation option */}
      <section className="bg-white py-10">
        <div className="container mx-auto px-6">
          <h2 className="text-h4 mb-6 text-center">
            Or jump straight to a dedicated page
          </h2>
          <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
            {SEGMENT_LINKS.map((link) => (
              <Link
                key={link.segment}
                to={link.href}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <h3 className="text-dark mb-1 text-lg font-bold">
                  {link.label}
                </h3>
                <p className="text-sm text-gray-700">{link.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FormSection headline="Or tell us here and we'll be in touch">
        <div className="space-y-6">
          <SegmentPicker value={segment} onChange={setSegment} />

          {variant !== null && segment.length > 0 ? (
            // `key` forces a fresh form when the user switches segment so the
            // adult/junior field set rebuilds cleanly.
            <LeadForm
              key={segment}
              campaignId="recruit-2026"
              segment={segment}
              variant={variant}
            />
          ) : (
            <p className="text-sm text-gray-600">
              Pick a group above to see the form.
            </p>
          )}
        </div>
      </FormSection>
    </>
  );
}
