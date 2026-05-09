import { OptimisedImage } from "@/components/optimised-image.js";
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
          <div className="max-w-2xl text-white">
            <h1 className="text-h2 md:text-h1 mb-4 leading-tight font-semibold tracking-tight text-white">
              {title}
            </h1>
            <p className="mb-6 text-lg text-balance text-white/90 md:text-xl">
              {description}
            </p>
            <a
              href={`#${FORM_ANCHOR_ID}`}
              className="bg-cta hover:bg-cta-dark inline-block rounded px-6 py-3 text-base font-semibold text-white shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              I&rsquo;m interested
            </a>
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
  <section className="bg-white py-10">
    <div className="container mx-auto px-6">
      <div className="grid gap-6 md:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.heading}
            className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-dark mb-2 text-lg font-semibold">
              {item.heading}
            </h2>
            <div className="text-sm text-stone-700">{item.body}</div>
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
  <section className="bg-white py-6">
    <div className="container mx-auto px-6">
      <p className="mx-auto max-w-3xl text-center text-sm text-stone-700">
        All junior sessions are run by DBS-checked coaches and a Level 3 Club
        Safeguarding Officer.{" "}
        <Link to={href} className="text-blue-900 underline">
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
  <section id={FORM_ANCHOR_ID} className="scroll-mt-16 bg-white py-12">
    <div className="container mx-auto px-6">
      <div className="mx-auto max-w-xl">
        <h2 className="text-h4 mb-6 text-center">{headline}</h2>
        {children}
      </div>
    </div>
  </section>
);
