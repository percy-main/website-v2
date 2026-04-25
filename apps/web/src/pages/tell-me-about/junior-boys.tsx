import { LeadForm } from "@/components/marketing/lead-form.js";
import {
  FormSection,
  ReassuranceList,
  RecruitHero,
  SafeguardingLine,
  TrialIsFree,
  type ReassuranceItem,
} from "@/components/marketing/recruit-page-sections.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";

const REASSURANCE: readonly ReassuranceItem[] = [
  {
    heading: "Who it's for",
    body: "Boys in school years 1 to 11. Sessions are grouped by age so your child trains alongside others at a similar stage. No previous cricket experience required.",
  },
  {
    heading: "When training happens",
    body: (
      <>
        Tuesday evenings during the season at our ground on St. Johns Terrace,
        Percy Main, North Shields, NE29 6HS:
        <ul className="mt-2 ml-5 list-disc space-y-1">
          <li>
            <strong>Under 11s</strong> — 4:30pm to 5:45pm
          </li>
          <li>
            <strong>Under 13 / Under 15 / Under 19</strong> — 6pm to 7:30pm
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "What to bring",
    body: "Nothing for the first session — we'll provide a bat, pads and a helmet. Your child should wear comfortable sportswear and trainers.",
  },
  {
    heading: "What happens next",
    body: "Submit the form and someone from the club will be in touch within one working day to agree a date that suits you. We'll meet you at the ground, introduce your child to the coach, and stay around if you'd like to watch.",
  },
];

export function Component() {
  useDocumentMeta(
    "Junior Boys Cricket — Percy Main Community Sports Club",
    "Free first session of junior boys cricket at Percy Main, North Tyneside. DBS-checked coaches. We'll be in touch within one working day.",
  );

  return (
    <>
      <RecruitHero
        title="Try junior boys cricket"
        description="Coaching for boys in school years 1–11 at Percy Main Cricket Club, North Shields. Friendly groups, qualified coaches, and a first session that's free."
        imageAlt="The cricket pitch at Percy Main"
      />
      <ReassuranceList items={REASSURANCE} />
      <TrialIsFree />
      <SafeguardingLine />
      <FormSection headline="Book your child's first cricket session">
        <LeadForm
          campaignId="recruit-2026"
          segment="junior_boys_cricket"
          variant="junior"
        />
      </FormSection>
    </>
  );
}
