import type { FC, ReactNode } from "react";
import { Link } from "react-router";

/**
 * Shared building blocks for the `/tell-me-about/*` recruit-2026 landing
 * pages. Kept in one file because the pages are intentionally near-identical
 * in structure — only the copy differs.
 */

interface RecruitHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  /** Provisional image URL — falls back gracefully if missing. */
  imageSrc?: string;
  imageAlt?: string;
}

export const RecruitHero: FC<RecruitHeroProps> = ({
  eyebrow,
  title,
  description,
  imageSrc = "/images/og-default.png",
  imageAlt = "",
}) => (
  <section className="relative">
    <div className="relative">
      <img
        src={imageSrc}
        alt={imageAlt}
        className="h-72 w-full object-cover md:h-96"
        // Don't break the page if the image is missing — hide the element
        // and let the dark gradient fill the space.
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
        loading="eager"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0 flex items-center">
        <div className="container mx-auto px-6">
          <div className="max-w-2xl text-white">
            <p className="mb-2 text-sm font-semibold tracking-wide text-white/80 uppercase">
              {eyebrow}
            </p>
            <h1 className="text-h2 md:text-h1 mb-4 leading-tight font-extrabold tracking-tight text-white">
              {title}
            </h1>
            <p className="text-lg text-balance text-white/90 md:text-xl">
              {description}
            </p>
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
            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-dark mb-2 text-lg font-bold">{item.heading}</h2>
            <div className="text-sm text-gray-700">{item.body}</div>
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
  href = "/legal/safeguarding-policy",
}) => (
  <section className="bg-white py-6">
    <div className="container mx-auto px-6">
      <p className="mx-auto max-w-3xl text-center text-sm text-gray-700">
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
  <section className="bg-white py-12">
    <div className="container mx-auto px-6">
      <div className="mx-auto max-w-xl">
        <h2 className="text-h4 mb-6 text-center">{headline}</h2>
        {children}
      </div>
    </div>
  </section>
);
