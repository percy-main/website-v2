import { LeadForm } from "@/components/marketing/lead-form.js";
import {
  FormSection,
  ReassuranceList,
  RecruitHero,
  TrialIsFree,
  type ReassuranceItem,
} from "@/components/marketing/recruit-page-sections.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";

const REASSURANCE: readonly ReassuranceItem[] = [
  {
    heading: "Who it's for",
    body: "Men aged 18 and over. Beginners welcome — most of our recent recruits hadn't picked up a bat in years (or ever). If you're already a club cricketer looking for a new home, you'll fit straight in.",
  },
  {
    heading: "When training happens",
    body: "Wednesday evenings, 6pm–8pm during the season at our ground on St. Johns Terrace, Percy Main, North Shields, NE29 6HS. Indoor nets through the winter — we'll point you to those when you get in touch.",
  },
  {
    heading: "What to bring",
    body: "Nothing. We'll sort kit for your first session. After that, most members buy their own bat and pads but the club has loan kit while you decide.",
  },
  {
    heading: "What happens next",
    body: "Submit the form and someone from the club will be in touch within one working day to agree a date that works for you. Then you turn up.",
  },
];

export function Component() {
  useDocumentMeta(
    "Try Men's Cricket — Percy Main Community Sports Club",
    "Free first session of men's cricket at Percy Main, North Tyneside. Submit your details and we'll be in touch within one working day.",
  );

  return (
    <>
      <RecruitHero
        title="Try a session of men's cricket"
        description="Hardball cricket in the Northumberland & Tyneside Cricket League. Adults of any experience level — from never-played to returning club cricketer."
        imageAlt="The cricket pitch at Percy Main"
      />
      <ReassuranceList items={REASSURANCE} />
      <TrialIsFree />
      <FormSection headline="Book your first men's cricket session">
        <LeadForm
          campaignId="recruit-2026"
          segment="senior_men_cricket"
          variant="adult"
        />
      </FormSection>
    </>
  );
}
