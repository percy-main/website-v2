import { ContentBody } from "@/components/content-body.js";
import { mdxComponents } from "@/components/mdx-components.js";
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
import { newsBySlug, type NewsArticle } from "@/lib/news.js";
import { getPersonBySlug, type PersonData } from "@/lib/people.js";
import { MDXProvider } from "@mdx-js/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { IoChevronForward } from "react-icons/io5";
import { Link, useParams } from "react-router";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");

type ApiArticle =
  paths["/api/content/{kind}/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];

function AuthorLink({ author }: { author: PersonData }) {
  const picture = author.photoPicture ?? ANON_PICTURE;
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
          src={author.photo ?? ANON_IMAGE}
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
  const author = meta?.authorSlug
    ? getPersonBySlug(meta.authorSlug)
    : undefined;

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

/** Bundled MDX article - the pre-#489 rendering, kept as fallback. */
function StaticArticleView({ article }: { article: NewsArticle }) {
  const PageContent = article.Component;

  return (
    <div className="container mx-auto px-4 py-6">
      <Breadcrumbs title={article.title} />

      <div className="max-w-3xl">
        {/* Author + date */}
        {article.author && <AuthorLink author={article.author} />}
        <p className="pb-4 text-sm text-stone-600">
          Published on {format(article.date, "PPPP")}
        </p>

        {/* Article content */}
        <MDXProvider components={mdxComponents}>
          <div className="mdx-content flex flex-col *:mb-4">
            <PageContent />
          </div>
        </MDXProvider>
      </div>
    </div>
  );
}

export function Component() {
  const params = useParams();
  const slug = params.id ?? "";

  // DB-backed article first (live content editing, #489); the bundled MDX
  // corpus stays as fallback until the migration is verified in prod, then
  // gets deleted in a follow-up. The MDX renders only once the query
  // settles (confirmed 404, or an API failure - deliberate graceful
  // degradation) so a DB-edited article never flashes its stale MDX
  // ancestor first.
  const { data: apiArticle, isPending } = useQuery(
    newsArticleQueryOptions(slug),
  );
  const staticArticle = newsBySlug.get(slug);

  useDocumentMeta(apiArticle?.title ?? staticArticle?.title ?? "News Article");

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

  if (staticArticle) {
    return <StaticArticleView article={staticArticle} />;
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
