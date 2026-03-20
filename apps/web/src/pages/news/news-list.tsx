import { OptimisedImage } from "@/components/optimised-image.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import { allNews, type NewsArticle } from "@/lib/news.js";
import { format } from "date-fns";
import { useState } from "react";
import { Link, useParams } from "react-router";
const PAGE_SIZE = 5;

// Compute all unique tags with counts
const allTags: Array<{ name: string; count: number }> = (() => {
  const counts = new Map<string, number>();
  for (const article of allNews) {
    for (const tag of article.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
})();

function FeaturedArticleCard({ article }: { article: NewsArticle }) {
  const initials = article.author?.name
    ? article.author.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <Link
      to={`/news/article/${article.slug}`}
      className="featured-card relative mb-7 block cursor-pointer overflow-hidden rounded-2xl bg-white"
    >
      <div className="from-primary via-primary-light to-cta h-1 bg-gradient-to-r" />
      <div className="flex flex-col gap-3.5 p-5 pb-6 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="bg-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold tracking-wider text-white uppercase">
            <svg
              className="h-3 w-3"
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
          <span className="text-[13px] text-gray-500">
            {format(article.date, "d MMMM yyyy")}
          </span>
        </div>

        <h2 className="font-secondary text-dark m-0 text-[22px] leading-snug font-bold sm:text-[28px]">
          {article.title}
        </h2>

        <div className="flex items-center justify-between border-t border-black/5 pt-4">
          <div className="flex items-center gap-2.5">
            {article.author?.photoPicture ? (
              <OptimisedImage
                picture={article.author.photoPicture}
                alt={article.author.name}
                className="h-8 w-8 shrink-0 rounded-full object-cover"
                sizes="32px"
              />
            ) : article.author?.photo ? (
              <img
                className="h-8 w-8 shrink-0 rounded-full object-cover"
                src={article.author.photo}
                alt={article.author.name}
              />
            ) : (
              <div className="bg-home-bg text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {initials}
              </div>
            )}
            <span className="text-dark text-sm font-semibold">
              {article.author?.name}
            </span>
          </div>
          <span className="text-primary inline-flex items-center gap-2 text-sm font-semibold">
            Read article
            <span className="bg-home-bg flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200">
              <svg
                className="h-3.5 w-3.5"
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
    </Link>
  );
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const initials = article.author?.name
    ? article.author.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <Link
      to={`/news/article/${article.slug}`}
      className="article-card relative mb-3.5 block cursor-pointer overflow-hidden rounded-[14px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-[250ms] hover:-translate-y-[3px] hover:shadow-[0_12px_32px_rgba(27,61,47,0.08),0_4px_8px_rgba(0,0,0,0.04)]"
    >
      <div className="flex flex-col gap-3 px-5 py-5 sm:px-6">
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
          <span className="shrink-0 text-[13px] whitespace-nowrap text-gray-500 max-md:hidden">
            {format(article.date, "EEEE, d MMMM yyyy")}
          </span>
        </div>

        <h3 className="font-secondary text-dark m-0 text-[20px] leading-snug font-bold transition-colors duration-150">
          {article.title}
        </h3>

        <div className="mt-0.5 flex items-center justify-between border-t border-black/[0.04] pt-3">
          <div className="flex items-center gap-2.5">
            {article.author?.photoPicture ? (
              <OptimisedImage
                picture={article.author.photoPicture}
                alt={article.author.name}
                className="h-7 w-7 shrink-0 rounded-full object-cover"
                sizes="28px"
              />
            ) : article.author?.photo ? (
              <img
                className="h-7 w-7 shrink-0 rounded-full object-cover"
                src={article.author.photo}
                alt={article.author.name}
              />
            ) : (
              <div className="bg-home-bg text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
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
    </Link>
  );
}

function Pagination({
  currentPage,
  lastPage,
}: {
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
          to={`/news/${currentPage - 1}`}
          className="text-text hover:border-primary hover:text-primary flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-gray-200 bg-white transition-all duration-150"
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
        <span className="text-text pointer-events-none flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-gray-200 bg-white opacity-30">
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
          to={`/news/${currentPage + 1}`}
          className="text-text hover:border-primary hover:text-primary flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-gray-200 bg-white transition-all duration-150"
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
        <span className="text-text pointer-events-none flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-gray-200 bg-white opacity-30">
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

function NewsSidebar({
  totalArticleCount,
  uniqueAuthorCount,
  archiveMonths,
}: {
  totalArticleCount: number;
  uniqueAuthorCount: number;
  archiveMonths: Array<{ month: string; count: number }>;
}) {
  return (
    <aside className="hidden w-[260px] shrink-0 lg:block">
      <div className="sticky top-4 flex flex-col gap-4">
        <div className="rounded-xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 text-sm font-bold">Overview</h3>
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
          <h3 className="mb-3 text-sm font-bold">Archive</h3>
          <div className="flex flex-col">
            {archiveMonths.map((m) => (
              <div
                key={m.month}
                className="text-text flex items-center justify-between border-b border-black/[0.04] py-1.5 text-[13px] last:border-b-0"
              >
                <span>{m.month}</span>
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

function FilterPills({
  activeTag,
  onTagChange,
}: {
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <button
        onClick={() => onTagChange(null)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
          activeTag === null
            ? "bg-primary text-white"
            : "text-text bg-white hover:bg-gray-50"
        }`}
      >
        All <span className="text-[11px] opacity-70">{allNews.length}</span>
      </button>
      {allTags.map((tag) => {
        const c = getCategoryColor(tag.name);
        const isActive = activeTag === tag.name;
        return (
          <button
            key={tag.name}
            onClick={() => onTagChange(isActive ? null : tag.name)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
              isActive ? "ring-primary/30 ring-2" : "bg-white hover:bg-gray-50"
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: c.dot }}
            />
            {tag.name}
            <span className="text-[11px] opacity-50">{tag.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Component() {
  const params = useParams();
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filteredNews = activeTag
    ? allNews.filter((a) => a.tags.includes(activeTag))
    : allNews;

  const lastPage = Math.max(1, Math.ceil(filteredNews.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, Number(params.page) || 1), lastPage);

  const pageArticles = filteredNews.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const showFeatured = currentPage === 1 && activeTag === null;
  const featuredArticle = showFeatured ? pageArticles[0] : null;
  const remainingArticles = featuredArticle
    ? pageArticles.slice(1)
    : pageArticles;

  // Group by month
  const byMonth = new Map<string, NewsArticle[]>();
  for (const article of remainingArticles) {
    const month = format(article.date, "MMMM yyyy");
    const existing = byMonth.get(month);
    if (existing) {
      existing.push(article);
    } else {
      byMonth.set(month, [article]);
    }
  }

  // Archive months from all articles
  const archiveMap = new Map<string, number>();
  for (const article of allNews) {
    const month = format(article.date, "MMMM yyyy");
    archiveMap.set(month, (archiveMap.get(month) ?? 0) + 1);
  }
  const archiveMonths = [...archiveMap.entries()].map(([month, count]) => ({
    month,
    count,
  }));

  // Unique authors
  const uniqueAuthors = new Set(
    allNews.map((a) => a.authorSlug).filter(Boolean),
  );

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
            {allNews.length} articles &middot; {allTags.length} tags
          </div>
        </div>
        {lastPage > 1 && (
          <Pagination currentPage={currentPage} lastPage={lastPage} />
        )}
      </div>

      {/* Filter pills */}
      <FilterPills activeTag={activeTag} onTagChange={setActiveTag} />

      {/* Main layout */}
      <div className="flex gap-8">
        <NewsSidebar
          totalArticleCount={allNews.length}
          uniqueAuthorCount={uniqueAuthors.size}
          archiveMonths={archiveMonths}
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

          {filteredNews.length === 0 && (
            <p className="py-8 text-center text-gray-500">
              No articles found for this tag.
            </p>
          )}

          <Pagination currentPage={currentPage} lastPage={lastPage} />
        </div>
      </div>
    </div>
  );
}
