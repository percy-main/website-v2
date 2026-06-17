import { OptimisedImage } from "@/components/optimised-image.js";
import { StampLink } from "@/components/theme/bits.js";
import { RisoHeading } from "@/components/theme/riso-heading.js";
import { getPicture } from "@/lib/image-map.js";
import type { FC, ReactNode } from "react";
import { Link } from "react-router";

/**
 * Shared building blocks for the `/tell-me-about/*` recruit-2026 landing
 * pages. Kept in one file because the pages are intentionally near-identical
 * in structure — only the copy differs.
 */

const FORM_ANCHOR_ID = "register-interest";

// Pitch photo - shipped at apps/web/src/assets/images/pitch.png so the
// optimised picture map always has it. Asserted non-null because the asset
// is part of the source tree.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- shipped asset, guaranteed present
const heroPicture = getPicture("/images/pitch.png")!;

interface RecruitHeroProps {
  title: string;
  description: string;
  imageAlt?: string;
}

export const RecruitHero: FC<RecruitHeroProps> = ({
  title,
  description,
  imageAlt = "Cricket at Percy Main",
}) => (
  <section className="relative">
    <div className="relative h-[28rem] md:h-[32rem]">
      <div className="absolute inset-0">
        <OptimisedImage
          picture={heroPicture}
          alt={imageAlt}
          loading="eager"
          fetchPriority="high"
          className="h-full w-full object-cover"
        />
      </div>
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0 flex items-center">
        <div className="container mx-auto px-6">
          <div className="flex max-w-2xl flex-col text-white">
            <RisoHeading
              as="h1"
              front="var(--fc-paper, #f1e5c9)"
              back="var(--fc-orange, #ef4a1e)"
              className="text-h2 md:text-h1 mb-4 leading-tight"
            >
              {title}
            </RisoHeading>
            <p className="mb-6 text-lg text-balance text-white/90 md:text-xl">
              {description}
            </p>
            <StampLink href={`#${FORM_ANCHOR_ID}`} className="self-start">
              I&rsquo;m interested &rarr;
            </StampLink>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export interface ReassuranceItem {
  heading: string;
  body: ReactNode;
}

interface ReassuranceListProps {
  items: readonly ReassuranceItem[];
}

export const ReassuranceList: FC<ReassuranceListProps> = ({ items }) => (
  <section className="bg-body py-10">
    <div className="container mx-auto px-6">
      <div className="grid gap-6 md:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.heading}
            className="border-primary bg-surface border-2 p-5 transition-transform hover:-translate-y-[3px]"
          >
            <h2 className="text-primary mb-2 text-lg font-semibold">
              {item.heading}
            </h2>
            <div className="text-muted text-sm">{item.body}</div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export const TrialIsFree: FC = () => (
  <section className="bg-primary/5 py-8">
    <div className="container mx-auto px-6">
      <p className="mx-auto max-w-3xl text-center text-base md:text-lg">
        <strong>Your first session is free.</strong> Membership details only
        come up if you decide to join after trying.
      </p>
    </div>
  </section>
);

interface SafeguardingLineProps {
  /** Override the default safeguarding link target if needed. */
  href?: string;
}

export const SafeguardingLine: FC<SafeguardingLineProps> = ({
  href = "/cricket/safeguarding",
}) => (
  <section className="bg-body py-6">
    <div className="container mx-auto px-6">
      <p className="text-muted mx-auto max-w-3xl text-center text-sm">
        All junior sessions are run by DBS-checked coaches and a Level 3 Club
        Safeguarding Officer.{" "}
        <Link
          to={href}
          className="text-primary decoration-cta/70 hover:text-cta underline underline-offset-2"
        >
          Read our safeguarding policy
        </Link>
        .
      </p>
    </div>
  </section>
);

interface FormSectionProps {
  headline: string;
  children: ReactNode;
}

export const FormSection: FC<FormSectionProps> = ({ headline, children }) => (
  <section id={FORM_ANCHOR_ID} className="bg-body scroll-mt-16 py-12">
    <div className="container mx-auto px-6">
      <div className="mx-auto max-w-xl">
        <h2 className="fc-two-tone text-h4 mb-6 text-center">{headline}</h2>
        {children}
      </div>
    </div>
  </section>
);
