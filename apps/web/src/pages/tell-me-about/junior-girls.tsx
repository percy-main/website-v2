import { LeadForm } from "@/components/marketing/lead-form.js";
import {
  FormSection,
  ReassuranceList,
  RecruitHero,
  SafeguardingLine,
  type ReassuranceItem,
} from "@/components/marketing/recruit-page-sections.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";

const REASSURANCE: readonly ReassuranceItem[] = [
  {
    heading: "Who it's for",
    body: "Girls aged 8 to 11 on the ECB Dynamos pathway. No previous experience required — Dynamos is built around learning the basics in a fun, mixed-ability group.",
  },
  {
    heading: "When training happens",
    body: "Monday evenings, 5pm–6pm at our ground on St. Johns Terrace, Percy Main, North Shields, NE29 6HS. The 2026 Dynamos block starts on 1 June.",
  },
  {
    heading: "What to bring",
    body: "Nothing for the first session — we'll sort kit. Comfortable sportswear and trainers are all your daughter needs.",
  },
  {
    heading: "What happens next",
    body: "Submit the form and someone from the club will be in touch within one working day to agree a date and walk you through the ECB Dynamos sign-up. We'll meet you at the ground, introduce your daughter to the coach, and you're welcome to stay and watch.",
  },
];

export function Component() {
  useDocumentMeta(
    "Junior Girls Dynamos Cricket — Percy Main Community Sports Club",
    "ECB Dynamos cricket for girls aged 8–11 at Percy Main, North Tyneside. Mondays from 1 June. We'll be in touch within one working day.",
  );

  return (
    <>
      <RecruitHero
        title="Girls' Dynamos cricket"
        description="Dynamos is the ECB's national programme for 8–11 year olds — focused on learning the game in a fun, mixed-ability setting. Sessions run at Percy Main Cricket Club, North Shields."
        imageAlt="The cricket pitch at Percy Main"
      />
      <ReassuranceList items={REASSURANCE} />
      <SafeguardingLine />
      <FormSection headline="Register your daughter for Dynamos">
        <LeadForm
          campaignId="recruit-2026"
          segment="junior_girls_dynamos_cricket"
          variant="junior"
        />
      </FormSection>
    </>
  );
}
