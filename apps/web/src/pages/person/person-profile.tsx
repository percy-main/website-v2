import { ContentBody } from "@/components/content-body.js";
import { mdxComponents } from "@/components/mdx-components.js";
import {
  OptimisedImage,
  type PictureSource,
} from "@/components/optimised-image.js";
import { PageLoading } from "@/components/page-loading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import {
  isPageGone,
  parsePersonMetadata,
  personQueryOptions,
} from "@/lib/content-queries.js";
import { getImageUrl, getPicture } from "@/lib/image-map.js";
import { getPersonBySlug } from "@/lib/people.js";
import { MDXProvider } from "@mdx-js/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";
import { PlayerSponsor } from "./player-sponsor.js";
import { PlayerStats } from "./player-stats.js";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");

/**
 * Shared profile chrome for both sources: breadcrumbs, photo, bio, the
 * stats sidebar and sponsorship CTA (deliberately untouched by #499 -
 * both key off the slug alone).
 */
function ProfileView({
  slug,
  name,
  picture,
  photoUrl,
  isDBSChecked,
  bio,
}: {
  slug: string;
  name: string;
  picture?: PictureSource;
  photoUrl?: string;
  isDBSChecked: boolean;
  bio: ReactNode;
}) {
  const effectivePicture = picture ?? ANON_PICTURE;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/people" className="hover:text-primary text-stone-600">
          People
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <span className="text-dark font-medium">{name}</span>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex-1">
          <div className="mb-4 flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex flex-col items-center justify-start gap-4 md:flex-row">
              {effectivePicture ? (
                <OptimisedImage
                  picture={effectivePicture}
                  alt={name}
                  className="mb-0 max-h-48 rounded-full"
                  sizes="132px"
                  width={132}
                  height={132}
                />
              ) : (
                <img
                  className="mb-0 max-h-48 rounded-full"
                  src={photoUrl ?? ANON_IMAGE}
                  alt={name}
                  width={132}
                  height={132}
                />
              )}
            </div>
          </div>

          {bio}

          <PlayerStats slug={slug} />
        </div>

        <aside className="w-full shrink-0 md:w-64">
          {isDBSChecked && (
            <div className="mb-4 flex justify-center">
              <img
                src="/images/dbs-checked.png"
                alt="DBS Checked"
                height={64}
                className="h-16"
              />
            </div>
          )}
          <PlayerSponsor slug={slug} />
        </aside>
      </div>
    </div>
  );
}

export function Component() {
  const params = useParams();
  const slug = params.slug ?? "";

  // DB-backed profile first (#499); the bundled MDX corpus stays as
  // fallback until the people migration is verified in prod, then gets
  // deleted in a follow-up. The MDX renders only on a CONFIRMED 404 -
  // never published in the DB - so an edited DB profile can't flash its
  // stale MDX ancestor, and never on an API error: unlike news/pages,
  // profiles fail CLOSED on incidents, because a 5xx must not resurrect
  // a profile whose takedown (410 tombstone / unpublish) the API can't
  // currently vouch for. Safeguarding beats graceful degradation here.
  const { data, isPending, isError } = useQuery(personQueryOptions(slug));
  const gone = isPageGone(data);
  const apiPerson = data == null || isPageGone(data) ? undefined : data;
  const staticPerson = gone || isError ? undefined : getPersonBySlug(slug);

  useDocumentMeta(apiPerson?.title ?? staticPerson?.name ?? "Player Profile");

  if (apiPerson) {
    const meta = parsePersonMetadata(apiPerson.metadata);
    return (
      <ProfileView
        slug={apiPerson.slug}
        name={apiPerson.title}
        picture={meta?.photo}
        isDBSChecked={meta?.isDBSChecked === true}
        bio={<ContentBody body={apiPerson.body} />}
      />
    );
  }

  if (isPending) {
    return (
      <div className="container mx-auto px-4 py-6">
        <PageLoading />
      </div>
    );
  }

  if (isError) {
    // Deliberately NOT the not-found copy: the profile may exist, we
    // just can't confirm its current state.
    return (
      <div className="container mx-auto px-4 py-12">
        <h1>Profile Unavailable</h1>
        <p>We couldn&apos;t load this profile right now - try again shortly.</p>
        <Link to="/people" className="text-primary hover:underline">
          Back to People
        </Link>
      </div>
    );
  }

  if (staticPerson) {
    const Bio = staticPerson.Component;
    return (
      <ProfileView
        slug={staticPerson.slug}
        name={staticPerson.name}
        picture={staticPerson.photoPicture}
        photoUrl={staticPerson.photo}
        isDBSChecked={staticPerson.isDBSChecked}
        bio={
          <MDXProvider components={mdxComponents}>
            <div className="mdx-content flex flex-col *:mb-4">
              <Bio />
            </div>
          </MDXProvider>
        }
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1>Person Not Found</h1>
      <p>The person you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/people" className="text-primary hover:underline">
        Back to People
      </Link>
    </div>
  );
}
