import { mdxComponents } from "@/components/mdx-components.js";
import { OptimisedImage } from "@/components/optimised-image.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { getImageUrl, getPicture } from "@/lib/image-map.js";
import { getPersonBySlug } from "@/lib/people.js";
import { MDXProvider } from "@mdx-js/react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";
import { PlayerSponsor } from "./player-sponsor.js";
import { PlayerStats } from "./player-stats.js";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");

export function Component() {
  const params = useParams();
  const person = getPersonBySlug(params.slug ?? "");

  useDocumentMeta(person?.name ?? "Player Profile");

  if (!person) {
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

  const Bio = person.Component;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        <Link to="/people" className="hover:text-primary text-stone-600">
          People
        </Link>
        <IoChevronForward className="text-stone-400" size={14} />
        <span className="text-dark font-medium">{person.name}</span>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex-1">
          <div className="mb-4 flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex flex-col items-center justify-start gap-4 md:flex-row">
              {(() => {
                const picture = person.photoPicture ?? ANON_PICTURE;
                return picture ? (
                  <OptimisedImage
                    picture={picture}
                    alt={person.name}
                    className="mb-0 max-h-48 rounded-full"
                    sizes="132px"
                    width={132}
                    height={132}
                  />
                ) : (
                  <img
                    className="mb-0 max-h-48 rounded-full"
                    src={person.photo ?? ANON_IMAGE}
                    alt={person.name}
                    width={132}
                    height={132}
                  />
                );
              })()}
            </div>
          </div>

          <MDXProvider components={mdxComponents}>
            <div className="mdx-content flex flex-col *:mb-4">
              <Bio />
            </div>
          </MDXProvider>

          <PlayerStats slug={person.slug} />
        </div>

        <aside className="w-full shrink-0 md:w-64">
          {person.isDBSChecked && (
            <div className="mb-4 flex justify-center">
              <img
                src="/images/dbs-checked.png"
                alt="DBS Checked"
                height={64}
                className="h-16"
              />
            </div>
          )}
          <PlayerSponsor slug={person.slug} />
        </aside>
      </div>
    </div>
  );
}
