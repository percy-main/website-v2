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
    body: "Tuesday evenings, 6:30pm–8pm during the season at our ground on St. Johns Terrace, North Shields, NE29 6HS. Some age groups also train on weekends — we'll point you to the right session when you get in touch.",
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
    "Junior Boys Cricket Trial — Percy Main Community Sports Club",
    "Free trial junior boys cricket session at Percy Main, North Tyneside. DBS-checked coaches. We'll be in touch within one working day.",
  );

  return (
    <>
      <RecruitHero
        eyebrow="Recruit 2026"
        title="Try junior boys cricket"
        description="Coaching for boys in school years 1–11 at Percy Main Cricket Club, North Shields. Friendly groups, qualified coaches, and a first session that's free."
        imageAlt="Junior cricket at Percy Main"
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
