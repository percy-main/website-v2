import { OptimisedImage } from "@/components/optimised-image.js";
import { PageLoading } from "@/components/page-loading.js";
import { PrefetchLink } from "@/components/prefetch-link.js";
import type { paths } from "@/lib/api.gen.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import {
  NEWS_PAGE_SIZE,
  newsArticleQueryOptions,
  newsListQueryOptions,
  parseNewsMetadata,
} from "@/lib/content-queries.js";
import { allNews, type NewsArticle } from "@/lib/news.js";
import { getPersonBySlug, type PersonData } from "@/lib/people.js";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, Navigate } from "react-router";

// Shared rendering for /news/:page and /news/tag/:tag/:page. The list is
// API-backed (live content editing, #489); the bundled MDX corpus stays as
// fallback until the content migration is verified in prod, then gets
// deleted in the cleanup PR.

/** One article row, whichever corpus it came from. */
interface NewsListItem {
  slug: string;
  title: string;
  date: Date;
  tags: string[];
  author: PersonData | undefined;
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

function apiItemToListItem(item: NewsListResponse["items"][number]) {
  const meta = parseNewsMetadata(item.metadata);
  return {
    slug: item.slug,
    title: item.title,
    date: new Date(item.publishedAt),
    tags: meta?.tags ?? [],
    author: meta?.authorSlug ? getPersonBySlug(meta.authorSlug) : undefined,
  } satisfies NewsListItem;
}

function staticToListItem(article: NewsArticle): NewsListItem {
  return {
    slug: article.slug,
    title: article.title,
    date: article.date,
    tags: article.tags,
    author: article.author,
  };
}

/** "2025-01" -> "January 2025" (matching the static page's archive labels). */
function formatArchiveMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return format(new Date(year, monthNumber - 1, 1), "MMMM yyyy");
}

// Static-corpus aggregates, only used by the transition fallback below.
const staticTags: Array<{ tag: string; count: number }> = (() => {
  const counts = new Map<string, number>();
  for (const article of allNews) {
    for (const tag of article.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
})();

function buildStaticViewModel(tag: string | null, page: number) {
  const filtered = tag ? allNews.filter((a) => a.tags.includes(tag)) : allNews;

  const lastPage = Math.max(1, Math.ceil(filtered.length / NEWS_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), lastPage);

  const items = filtered
    .slice((currentPage - 1) * NEWS_PAGE_SIZE, currentPage * NEWS_PAGE_SIZE)
    .map(staticToListItem);

  const archiveMap = new Map<string, number>();
  for (const article of allNews) {
    const month = format(article.date, "MMMM yyyy");
    archiveMap.set(month, (archiveMap.get(month) ?? 0) + 1);
  }
  const archiveMonths = [...archiveMap.entries()].map(([label, count]) => ({
    label,
    count,
  }));

  const uniqueAuthors = new Set(
    allNews.flatMap((a) => (a.authorSlug ? [a.authorSlug] : [])),
  );

  return {
    items,
    currentPage,
    lastPage,
    tags: staticTags,
    archiveMonths,
    totalArticles: allNews.length,
    authorCount: uniqueAuthors.size,
  } satisfies NewsListViewModel;
}

function buildApiViewModel(response: NewsListResponse, page: number) {
  const lastPage = Math.max(1, Math.ceil(response.total / NEWS_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), lastPage);

  return {
    items: response.items.map(apiItemToListItem),
    currentPage,
    lastPage,
    tags: response.tags.toSorted((a, b) => b.count - a.count),
    // YYYY-MM sorts lexicographically in date order; newest first, like
    // the static corpus (which is ordered by article date desc).
    archiveMonths: response.archive
      .toSorted((a, b) => b.month.localeCompare(a.month))
      .map((m) => ({ label: formatArchiveMonth(m.month), count: m.count })),
    totalArticles: response.archive.reduce((sum, m) => sum + m.count, 0),
    authorCount: response.authorCount,
  } satisfies NewsListViewModel;
}

// ── Cards ───────────────────────────────────────────────────────────────

function authorInitials(author: PersonData | undefined): string {
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
      className="featured-card relative mb-7 block cursor-pointer overflow-hidden rounded-2xl bg-white"
    >
      <div className="from-primary via-primary-light to-cta h-1 bg-gradient-to-r" />
      <div className="flex flex-col gap-3.5 p-5 pb-6 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="bg-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold tracking-wider text-white uppercase">
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
          <span className="text-[13px] text-stone-500">
            {format(article.date, "d MMMM yyyy")}
          </span>
        </div>

        <h2 className="font-secondary text-dark m-0 text-[22px] leading-snug font-semibold sm:text-[28px]">
          {article.title}
        </h2>

        <div className="flex items-center justify-between border-t border-black/5 pt-4">
          <div className="flex items-center gap-2.5">
            {article.author?.photoPicture ? (
              <OptimisedImage
                picture={article.author.photoPicture}
                alt={article.author.name}
                className="size-8 shrink-0 rounded-full object-cover"
                sizes="32px"
              />
            ) : article.author?.photo ? (
              <img
                className="size-8 shrink-0 rounded-full object-cover"
                src={article.author.photo}
                alt={article.author.name}
              />
            ) : (
              <div className="bg-home-bg text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {initials}
              </div>
            )}
            <span className="text-dark text-sm font-semibold">
              {article.author?.name}
            </span>
          </div>
          <span className="text-primary inline-flex items-center gap-2 text-sm font-semibold">
            Read article
            <span className="bg-home-bg flex size-7 items-center justify-center rounded-full transition-all duration-200">
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
      className="article-card relative mb-3.5 block cursor-pointer overflow-hidden rounded-[14px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-[250ms] hover:-translate-y-[3px] hover:shadow-[0_12px_32px_rgba(27,61,47,0.08),0_4px_8px_rgba(0,0,0,0.04)]"
    >
      <div className="flex flex-col gap-3 p-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {article.tags.map((tag) => {
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
          <span className="shrink-0 text-[13px] whitespace-nowrap text-stone-500 max-md:hidden">
            {format(article.date, "EEEE, d MMMM yyyy")}
          </span>
        </div>

        <h3 className="font-secondary text-dark m-0 text-[20px] leading-snug font-semibold transition-colors duration-150">
          {article.title}
        </h3>

        <div className="mt-0.5 flex items-center justify-between border-t border-black/[0.04] pt-3">
          <div className="flex items-center gap-2.5">
            {article.author?.photoPicture ? (
              <OptimisedImage
                picture={article.author.photoPicture}
                alt={article.author.name}
                className="size-7 shrink-0 rounded-full object-cover"
                sizes="28px"
              />
            ) : article.author?.photo ? (
              <img
                className="size-7 shrink-0 rounded-full object-cover"
                src={article.author.photo}
                alt={article.author.name}
              />
            ) : (
              <div className="bg-home-bg text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                {initials}
              </div>
            )}
            <span className="text-dark text-[13px] font-semibold">
              {article.author?.name}
            </span>
          </div>
          <span className="text-primary inline-flex items-center gap-1.5 text-[13px] font-semibold">
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
          className="text-text hover:border-primary hover:text-primary flex size-9 items-center justify-center rounded-full border-[1.5px] border-stone-200 bg-white transition-all duration-150"
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
        <span className="text-text pointer-events-none flex size-9 items-center justify-center rounded-full border-[1.5px] border-stone-200 bg-white opacity-30">
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
      <span className="text-text min-w-[60px] px-2 text-center text-[13px] opacity-50">
        {currentPage} / {lastPage}
      </span>
      {currentPage < lastPage ? (
        <Link
          to={`${basePath}/${String(currentPage + 1)}`}
          className="text-text hover:border-primary hover:text-primary flex size-9 items-center justify-center rounded-full border-[1.5px] border-stone-200 bg-white transition-all duration-150"
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
        <span className="text-text pointer-events-none flex size-9 items-center justify-center rounded-full border-[1.5px] border-stone-200 bg-white opacity-30">
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
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 text-sm font-semibold">Overview</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-home-bg text-primary rounded-lg p-2.5 text-center">
              <div className="font-secondary text-xl leading-none font-bold">
                {totalArticleCount}
              </div>
              <div className="mt-1 text-[10px] font-semibold tracking-wide uppercase">
                Articles
              </div>
            </div>
            <div className="rounded-lg bg-[#fef3c7] p-2.5 text-center text-[#d97706]">
              <div className="font-secondary text-xl leading-none font-bold">
                {uniqueAuthorCount}
              </div>
              <div className="mt-1 text-[10px] font-semibold tracking-wide uppercase">
                Authors
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 text-sm font-semibold">Archive</h3>
          <div className="flex flex-col">
            {archiveMonths.map((m) => (
              <div
                key={m.label}
                className="text-text flex items-center justify-between border-b border-black/[0.04] py-1.5 text-[13px] last:border-b-0"
              >
                <span>{m.label}</span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold">
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
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
          activeTag === null
            ? "bg-primary text-white"
            : "text-text bg-white hover:bg-stone-50"
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
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
              isActive ? "ring-primary/30 ring-2" : "bg-white hover:bg-stone-50"
            }`}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: c.dot }}
            />
            {tag}
            <span className="text-[11px] opacity-50">{count}</span>
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

  if (isPending) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="text-h4 mb-4 flex items-center gap-2">
          <span className="text-dark font-medium">News</span>
        </div>
        <h1 className="mb-1 text-[2rem] leading-tight">News</h1>
        <PageLoading />
      </div>
    );
  }

  // TRANSITION FALLBACK (#489): until the content migration has run in
  // prod the DB holds no published news. The archive counts span ALL
  // published news regardless of ?tag, so a zero sum means the DB corpus
  // is empty and the bundled MDX stays canonical. An API error degrades
  // the same way so the page keeps working. Remove in the cleanup PR once
  // the migration is verified in prod.
  const apiHasNews = (data?.archive ?? []).some((m) => m.count > 0);
  const vm =
    !isError && data && apiHasNews
      ? buildApiViewModel(data, page)
      : buildStaticViewModel(tag, page);

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
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        <span className="text-dark font-medium">News</span>
      </div>

      {/* Page header */}
      <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <h1 className="mb-1 text-[2rem] leading-tight">News</h1>
          <div className="text-text text-sm opacity-60">
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
              <div className="font-secondary border-primary text-dark mb-3.5 inline-block border-b-2 pb-2 text-base font-bold">
                {month}
              </div>
              {articles.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          ))}

          {vm.items.length === 0 && (
            <p className="py-8 text-center text-stone-500">
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
