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
    body: "Women aged 18 and over. No previous experience needed — softball cricket is designed for people who've never played. If you have played before, you'll still enjoy it; the format is friendlier and faster than hardball.",
  },
  {
    heading: "When training happens",
    body: "Tuesday evenings, 6:30pm–8pm during the season at our ground on St. Johns Terrace, North Shields, NE29 6HS. Indoor sessions over the winter — we'll let you know dates when you get in touch.",
  },
  {
    heading: "What to bring",
    body: "Nothing. We'll provide everything for your first session. The softball format uses a softer ball and lighter kit, so there's nothing intimidating to buy up front.",
  },
  {
    heading: "What happens next",
    body: "Submit the form and someone from the club will be in touch within one working day to agree a date. Then you turn up.",
  },
];

export function Component() {
  useDocumentMeta(
    "Try Women's Softball Cricket — Percy Main Community Sports Club",
    "Free trial women's softball cricket session at Percy Main, North Tyneside. Beginners welcome. We'll be in touch within one working day.",
  );

  return (
    <>
      <RecruitHero
        eyebrow="Recruit 2026"
        title="Try women's softball cricket"
        description="Softball cricket is a shorter, more welcoming format of the game — perfect if you've never picked up a bat before. Played with a softer ball, smaller teams, and shorter games."
        imageAlt="Women's cricket at Percy Main"
      />
      <ReassuranceList items={REASSURANCE} />
      <TrialIsFree />
      <FormSection headline="Book your first women's softball session">
        <LeadForm
          campaignId="recruit-2026"
          segment="senior_women_softball_cricket"
          variant="adult"
        />
      </FormSection>
    </>
  );
}
