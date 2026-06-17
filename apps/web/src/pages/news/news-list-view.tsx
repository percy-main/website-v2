import { OptimisedImage } from "@/components/optimised-image.js";
import { PageLoading } from "@/components/page-loading.js";
import { PrefetchLink } from "@/components/prefetch-link.js";
import { Kicker } from "@/components/theme/bits.js";
import { RisoHeading } from "@/components/theme/riso-heading.js";
import type { paths } from "@/lib/api.gen.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import {
  NEWS_PAGE_SIZE,
  newsArticleQueryOptions,
  newsListQueryOptions,
  parseNewsMetadata,
} from "@/lib/content-queries.js";
import { usePeople, type PersonSummary } from "@/lib/use-people.js";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, Navigate } from "react-router";

// Shared rendering for /news/:page and /news/tag/:tag/:page. The list is
// API-backed (live content editing, #489).

/** One article row. */
interface NewsListItem {
  slug: string;
  title: string;
  date: Date;
  tags: string[];
  author: PersonSummary | undefined;
}

interface NewsListViewModel {
  items: NewsListItem[];
  currentPage: number;
  lastPage: number;
  tags: Array<{ tag: string; count: number }>;
  archiveMonths: Array<{ label: string; count: number }>;
  /** Across ALL published news, ignoring any tag filter. */
  totalArticles: number;
  authorCount: number;
}

// ── Corpus mapping ──────────────────────────────────────────────────────

type NewsListResponse =
  paths["/api/content/news"]["get"]["responses"]["200"]["content"]["application/json"];

/** "2025-01" -> "January 2025". */
function formatArchiveMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return format(new Date(year, monthNumber - 1, 1), "MMMM yyyy");
}

function buildApiViewModel(
  response: NewsListResponse,
  page: number,
  people: Map<string, PersonSummary>,
) {
  const lastPage = Math.max(1, Math.ceil(response.total / NEWS_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), lastPage);

  return {
    items: response.items.map((item) => {
      const meta = parseNewsMetadata(item.metadata);
      return {
        slug: item.slug,
        title: item.title,
        date: new Date(item.publishedAt),
        tags: meta?.tags ?? [],
        author: meta?.authorSlug ? people.get(meta.authorSlug) : undefined,
      } satisfies NewsListItem;
    }),
    currentPage,
    lastPage,
    tags: response.tags.toSorted((a, b) => b.count - a.count),
    // YYYY-MM sorts lexicographically in date order; newest first.
    archiveMonths: response.archive
      .toSorted((a, b) => b.month.localeCompare(a.month))
      .map((m) => ({ label: formatArchiveMonth(m.month), count: m.count })),
    totalArticles: response.archive.reduce((sum, m) => sum + m.count, 0),
    authorCount: response.authorCount,
  } satisfies NewsListViewModel;
}

// ── Cards ───────────────────────────────────────────────────────────────

function authorInitials(author: PersonSummary | undefined): string {
  return author?.name
    ? author.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";
}

function FeaturedArticleCard({ article }: { article: NewsListItem }) {
  const initials = authorInitials(article.author);

  return (
    <PrefetchLink
      query={newsArticleQueryOptions(article.slug)}
      to={`/news/article/${article.slug}`}
      className="group border-primary bg-surface relative mb-7 block cursor-pointer overflow-hidden border-2 transition-transform duration-200 hover:-translate-y-[3px]"
    >
      <div className="bg-cta h-1.5" />
      <div className="flex flex-col gap-3.5 p-5 pb-6 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="bg-primary text-paper inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold tracking-wider uppercase">
            <svg
              className="size-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Latest
          </span>
          <span className="text-muted text-[13px]">
            {format(article.date, "d MMMM yyyy")}
          </span>
        </div>

        <h2 className="font-secondary text-primary group-hover:text-cta m-0 text-[26px] leading-[0.95] tracking-wide uppercase transition-colors duration-150 sm:text-[32px]">
          {article.title}
        </h2>

        <div className="border-primary/15 flex items-center justify-between border-t pt-4">
          <div className="flex items-center gap-2.5">
            {article.author?.picture ? (
              <OptimisedImage
                picture={article.author.picture}
                alt={article.author.name}
                className="size-8 shrink-0 rounded-full object-cover"
                sizes="32px"
              />
            ) : (
              <div className="bg-primary text-paper flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {initials}
              </div>
            )}
            <span className="text-primary text-sm font-semibold">
              {article.author?.name}
            </span>
          </div>
          <span className="text-primary group-hover:text-cta inline-flex items-center gap-2 text-sm font-semibold transition-colors duration-150">
            Read article
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
      </div>
    </PrefetchLink>
  );
}

function ArticleCard({ article }: { article: NewsListItem }) {
  const initials = authorInitials(article.author);

  return (
    <PrefetchLink
      query={newsArticleQueryOptions(article.slug)}
      to={`/news/article/${article.slug}`}
      className="group border-primary bg-surface relative mb-3.5 block cursor-pointer overflow-hidden border-2 transition-transform duration-200 hover:-translate-y-[3px]"
    >
      <div className="flex flex-col gap-3 p-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {article.tags.map((tag) => {
              const c = getCategoryColor(tag);
              return (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
                  style={{ background: c.bg, color: c.text }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
          <span className="text-muted shrink-0 text-[13px] whitespace-nowrap max-md:hidden">
            {format(article.date, "EEEE, d MMMM yyyy")}
          </span>
        </div>

        <h3 className="font-secondary text-primary group-hover:text-cta m-0 text-[24px] leading-[0.95] tracking-wide uppercase transition-colors duration-150">
          {article.title}
        </h3>

        <div className="border-primary/15 mt-0.5 flex items-center justify-between border-t pt-3">
          <div className="flex items-center gap-2.5">
            {article.author?.picture ? (
              <OptimisedImage
                picture={article.author.picture}
                alt={article.author.name}
                className="size-7 shrink-0 rounded-full object-cover"
                sizes="28px"
              />
            ) : (
              <div className="bg-primary text-paper flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                {initials}
              </div>
            )}
            <span className="text-primary text-[13px] font-semibold">
              {article.author?.name}
            </span>
          </div>
          <span className="text-primary group-hover:text-cta inline-flex items-center gap-1.5 text-[13px] font-semibold transition-colors duration-150">
            Read article
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </div>
      </div>
    </PrefetchLink>
  );
}

// ── Pagination ──────────────────────────────────────────────────────────

function Pagination({
  basePath,
  currentPage,
  lastPage,
}: {
  basePath: string;
  currentPage: number;
  lastPage: number;
}) {
  if (lastPage <= 1) return null;

  return (
    <nav
      aria-label="Page navigation"
      className="flex items-center justify-center gap-1 pt-4"
    >
      {currentPage > 1 ? (
        <Link
          to={`${basePath}/${String(currentPage - 1)}`}
          className="border-border bg-surface text-primary hover:bg-primary hover:text-paper hover:border-primary flex size-9 items-center justify-center border-2 transition-colors duration-150"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
      ) : (
        <span className="border-border bg-surface text-primary pointer-events-none flex size-9 items-center justify-center border-2 opacity-30">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </span>
      )}
      <span className="text-muted min-w-[60px] px-2 text-center text-[13px] font-semibold">
        {currentPage} / {lastPage}
      </span>
      {currentPage < lastPage ? (
        <Link
          to={`${basePath}/${String(currentPage + 1)}`}
          className="border-border bg-surface text-primary hover:bg-primary hover:text-paper hover:border-primary flex size-9 items-center justify-center border-2 transition-colors duration-150"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      ) : (
        <span className="border-border bg-surface text-primary pointer-events-none flex size-9 items-center justify-center border-2 opacity-30">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      )}
    </nav>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────────

function NewsSidebar({
  totalArticleCount,
  uniqueAuthorCount,
  archiveMonths,
}: {
  totalArticleCount: number;
  uniqueAuthorCount: number;
  archiveMonths: Array<{ label: string; count: number }>;
}) {
  return (
    <aside className="hidden w-[260px] shrink-0 lg:block">
      <div className="sticky top-4 flex flex-col gap-4">
        <div className="border-primary bg-surface border-2 p-4">
          <h3 className="font-secondary text-primary mb-3 text-base tracking-wide uppercase">
            Overview
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="border-border bg-surface text-primary border p-2.5 text-center">
              <div className="font-secondary text-2xl leading-none">
                {totalArticleCount}
              </div>
              <div className="text-muted mt-1 text-[10px] font-semibold tracking-wide uppercase">
                Articles
              </div>
            </div>
            <div className="border-border bg-surface text-cta border p-2.5 text-center">
              <div className="font-secondary text-2xl leading-none">
                {uniqueAuthorCount}
              </div>
              <div className="text-muted mt-1 text-[10px] font-semibold tracking-wide uppercase">
                Authors
              </div>
            </div>
          </div>
        </div>

        <div className="border-primary bg-surface border-2 p-4">
          <h3 className="font-secondary text-primary mb-3 text-base tracking-wide uppercase">
            Archive
          </h3>
          <div className="flex flex-col">
            {archiveMonths.map((m) => (
              <div
                key={m.label}
                className="text-muted border-border/40 flex items-center justify-between border-b py-1.5 text-[13px] last:border-b-0"
              >
                <span>{m.label}</span>
                <span className="bg-primary text-paper px-2 py-0.5 text-[11px] font-semibold">
                  {m.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Filter pills ────────────────────────────────────────────────────────
//
// Tag filtering is real routes, not component state: pills link to
// /news/tag/:tag/1, "All" (and re-clicking the active tag) links back to
// /news/1.

function FilterPills({
  tags,
  activeTag,
  totalCount,
}: {
  tags: Array<{ tag: string; count: number }>;
  activeTag: string | null;
  totalCount: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Link
        to="/news/1"
        className={`inline-flex items-center gap-1.5 border-2 px-3.5 py-1.5 text-[13px] font-semibold tracking-wide uppercase transition-colors ${
          activeTag === null
            ? "border-primary bg-primary text-paper"
            : "border-border bg-surface text-primary hover:bg-cta/10"
        }`}
      >
        All <span className="text-[11px] opacity-70">{totalCount}</span>
      </Link>
      {tags.map(({ tag, count }) => {
        const c = getCategoryColor(tag);
        const isActive = activeTag === tag;
        return (
          <Link
            key={tag}
            to={isActive ? "/news/1" : `/news/tag/${encodeURIComponent(tag)}/1`}
            className={`inline-flex items-center gap-1.5 border-2 px-3.5 py-1.5 text-[13px] font-semibold tracking-wide uppercase transition-colors ${
              isActive
                ? "border-primary bg-primary text-paper"
                : "border-border bg-surface text-primary hover:bg-cta/10"
            }`}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: c.dot }}
            />
            {tag}
            <span className="text-[11px] opacity-60">{count}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ── View ────────────────────────────────────────────────────────────────

export function NewsListView({
  tag = null,
  page,
}: {
  tag?: string | null;
  page: number;
}) {
  const { data, isPending, isError } = useQuery(
    newsListQueryOptions({ tag: tag ?? undefined, page }),
  );
  const people = usePeople();

  if (isPending) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Kicker className="mb-3">From the club</Kicker>
        <RisoHeading as="h1">News</RisoHeading>
        <PageLoading />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1>We couldn&apos;t load the news</h1>
        <p>
          Something went wrong fetching the news. Please try again in a few
          minutes.
        </p>
      </div>
    );
  }

  const vm = buildApiViewModel(data, page, people);

  const basePath = tag ? `/news/tag/${encodeURIComponent(tag)}` : "/news";

  // An out-of-range page (e.g. /news/999) clamps to the last real page.
  // The view model already clamped currentPage, but the API was asked for
  // the requested page, so its items would be empty - redirect instead of
  // rendering a hollow page.
  if (page !== vm.currentPage) {
    return <Navigate to={`${basePath}/${String(vm.currentPage)}`} replace />;
  }

  const showFeatured = vm.currentPage === 1 && tag === null;
  const featuredArticle = showFeatured ? (vm.items[0] ?? null) : null;
  const remainingArticles = featuredArticle ? vm.items.slice(1) : vm.items;

  // Group the page's articles by month
  const byMonth = new Map<string, NewsListItem[]>();
  for (const article of remainingArticles) {
    const month = format(article.date, "MMMM yyyy");
    const existing = byMonth.get(month);
    if (existing) {
      existing.push(article);
    } else {
      byMonth.set(month, [article]);
    }
  }

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Page header */}
      <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Kicker className="mb-3">From the club</Kicker>
          <RisoHeading as="h1">News</RisoHeading>
          <div className="text-muted mt-2 text-sm font-semibold tracking-wide uppercase">
            {vm.totalArticles} articles &middot; {vm.tags.length} tags
          </div>
        </div>
        {vm.lastPage > 1 && (
          <Pagination
            basePath={basePath}
            currentPage={vm.currentPage}
            lastPage={vm.lastPage}
          />
        )}
      </div>

      {/* Filter pills */}
      <FilterPills
        tags={vm.tags}
        activeTag={tag}
        totalCount={vm.totalArticles}
      />

      {/* Main layout */}
      <div className="flex gap-8">
        <NewsSidebar
          totalArticleCount={vm.totalArticles}
          uniqueAuthorCount={vm.authorCount}
          archiveMonths={vm.archiveMonths}
        />

        <div className="min-w-0 flex-1">
          {featuredArticle && <FeaturedArticleCard article={featuredArticle} />}

          {[...byMonth.entries()].map(([month, articles]) => (
            <div key={month} className="mb-7">
              <div className="font-secondary border-cta text-primary mb-3.5 inline-block border-b-2 pb-2 text-lg tracking-wide uppercase">
                {month}
              </div>
              {articles.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          ))}

          {vm.items.length === 0 && (
            <p className="text-muted py-8 text-center">
              No articles found for this tag.
            </p>
          )}

          <Pagination
            basePath={basePath}
            currentPage={vm.currentPage}
            lastPage={vm.lastPage}
          />
        </div>
      </div>
    </div>
  );
}
