import { ContentBody } from "@/components/content-body.js";
import { OptimisedImage } from "@/components/optimised-image.js";
import { PageLoading } from "@/components/page-loading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import type { paths } from "@/lib/api.gen.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import {
  newsArticleQueryOptions,
  parseNewsMetadata,
} from "@/lib/content-queries.js";
import { getImageUrl, getPicture } from "@/lib/image-map.js";
import { usePeople, type PersonSummary } from "@/lib/use-people.js";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");

type ApiArticle =
  paths["/api/content/{kind}/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];

function AuthorLink({ author }: { author: PersonSummary }) {
  const picture = author.picture ?? ANON_PICTURE;
  return (
    <Link to={`/person/${author.slug}`} className="flex items-center gap-4">
      {picture ? (
        <OptimisedImage
          picture={picture}
          alt={author.name}
          className="size-14 rounded-full object-cover"
          sizes="56px"
        />
      ) : (
        <img
          className="size-14 rounded-full object-cover"
          src={ANON_IMAGE}
          alt={author.name}
        />
      )}
      <span className="text-dark font-medium">{author.name}</span>
    </Link>
  );
}

function Breadcrumbs({ title }: { title: string }) {
  return (
    <div className="text-h4 mb-4 flex items-center gap-2">
      <Link to="/news/1" className="hover:text-primary text-stone-600">
        News
      </Link>
      <IoChevronForward className="text-stone-400" size={14} />
      <span className="text-dark font-medium">{title}</span>
    </div>
  );
}

/** DB-backed article (live content editing, #489). */
function ApiArticleView({ article }: { article: ApiArticle }) {
  const meta = parseNewsMetadata(article.metadata);
  const people = usePeople();
  const author = meta?.authorSlug ? people.get(meta.authorSlug) : undefined;

  return (
    <div className="container mx-auto px-4 py-6">
      <Breadcrumbs title={article.title} />

      <div className="max-w-3xl">
        <h1 className="mb-4 text-[2rem] leading-tight">{article.title}</h1>

        {/* Author + date */}
        {author && <AuthorLink author={author} />}
        <p className="pb-4 text-sm text-stone-600">
          Published on {format(new Date(article.publishedAt), "PPPP")}
        </p>

        {/* Tags */}
        {meta && meta.tags.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {meta.tags.map((tag) => {
              const c = getCategoryColor(tag);
              return (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
                  style={{ background: c.bg, color: c.text }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
        )}

        {/* Article content */}
        <ContentBody body={article.body} />
      </div>
    </div>
  );
}

export function Component() {
  const params = useParams();
  const slug = params.id ?? "";

  const {
    data: apiArticle,
    isPending,
    isError,
  } = useQuery(newsArticleQueryOptions(slug));

  useDocumentMeta(apiArticle?.title ?? "News Article");

  if (apiArticle) {
    return <ApiArticleView article={apiArticle} />;
  }

  if (isPending) {
    return (
      <div className="container mx-auto px-4 py-6">
        <PageLoading />
      </div>
    );
  }

  // The query returns null on a confirmed 404 and throws on anything
  // else - an API incident must not read as "this article doesn't exist".
  if (isError) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1>We couldn&apos;t load this article</h1>
        <p>
          Something went wrong fetching this article. Please try again in a few
          minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1>Article Not Found</h1>
      <p>The article you're looking for doesn't exist.</p>
      <Link to="/news/1" className="text-primary hover:underline">
        Back to News
      </Link>
    </div>
  );
}
