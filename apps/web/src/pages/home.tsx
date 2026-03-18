import { allNews } from "@/lib/news.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import { format } from "date-fns";
import { Link } from "react-router";

const DONATE_URL = "/purchase/donation";

const sports = [
  {
    name: "Cricket",
    description:
      "Men's, women's, and junior teams competing in the Northumberland & Tyneside Cricket League",
    href: "/cricket",
    icon: "\u{1F3CF}",
  },
  {
    name: "Football",
    description:
      "Grassroots football for the local community with Percy Main Amateurs FC",
    href: "/football",
    icon: "\u26BD",
  },
  {
    name: "Boxing",
    description:
      "Amateur boxing training and development with BKFC Gym Percy Main",
    href: "/boxing",
    icon: "\u{1F94A}",
  },
  {
    name: "Running",
    description: "Social running group for all abilities",
    href: "/running",
    icon: "\u{1F3C3}",
  },
] as const;

const top5 = allNews.slice(0, 5);

function HomeArticleCard({
  article,
}: {
  article: (typeof allNews)[number];
}) {
  const firstTag = article.tags[0];
  const accentColor = firstTag
    ? getCategoryColor(firstTag)
    : getCategoryColor("");
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
      className="group relative block overflow-hidden rounded-[14px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-[250ms] hover:-translate-y-[3px] hover:shadow-[0_12px_32px_rgba(27,61,47,0.08),0_4px_8px_rgba(0,0,0,0.04)]"
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
          <span className="shrink-0 whitespace-nowrap text-[13px] text-text opacity-45 max-md:hidden">
            {format(article.date, "d MMM yyyy")}
          </span>
        </div>

        <h3 className="font-secondary m-0 text-[20px] font-bold leading-snug text-dark transition-colors duration-150 group-hover:text-primary">
          {article.title}
        </h3>

        <div className="mt-0.5 flex items-center justify-between border-t border-black/[0.04] pt-3">
          <div className="flex items-center gap-2.5">
            {article.author?.photo ? (
              <img
                className="h-7 w-7 shrink-0 rounded-full object-cover"
                src={article.author.photo}
                alt={article.author.name}
              />
            ) : (
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{
                  background: accentColor.bg,
                  color: accentColor.text,
                }}
              >
                {initials}
              </div>
            )}
            <span className="text-[13px] font-semibold text-dark">
              {article.author?.name}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function Component() {
  return (
    <>
      {/* Hero */}
      <section className="bg-primary py-16 text-white md:py-24">
        <div className="container mx-auto px-8 text-center">
          <h1 className="text-h1-sm md:text-h1 mb-4 text-white">
            Percy Main Community Sports Club
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80">
            Supporting community sport in Percy Main and surrounding areas since
            1884. Cricket, football, boxing, and running for all ages and
            abilities.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/auth/register"
              className="bg-cta hover:bg-cta-dark rounded-lg px-8 py-3 text-lg font-medium text-white transition"
            >
              Join Us
            </Link>
            <Link
              to="/calendar"
              className="rounded-lg border border-white/30 px-8 py-3 text-lg font-medium text-white transition hover:bg-white/10"
            >
              What&apos;s On
            </Link>
          </div>
        </div>
      </section>

      {/* Latest News */}
      {top5.length > 0 && (
        <section className="py-10">
          <div className="container mx-auto px-8">
            <h3 className="text-h4 mb-6 text-center">Latest News</h3>

            {/* Top row: 2 articles */}
            <div className="grid gap-6 md:grid-cols-2">
              {top5.slice(0, 2).map((article) => (
                <HomeArticleCard key={article.slug} article={article} />
              ))}
            </div>

            {/* Bottom row: up to 3 articles */}
            {top5.length > 2 && (
              <div className="mt-6 grid gap-6 md:grid-cols-3">
                {top5.slice(2, 5).map((article) => (
                  <HomeArticleCard key={article.slug} article={article} />
                ))}
              </div>
            )}

            <div className="mt-8 text-center">
              <Link
                to="/news/1"
                className="text-sm font-medium text-primary transition hover:text-primary-light"
              >
                View all news &rarr;
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Our Sports */}
      <section className="bg-primary/5 py-12">
        <div className="container mx-auto px-8">
          <h3 className="text-h4 mb-8 text-center">Our Sports</h3>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {sports.map((sport) => (
              <Link
                key={sport.name}
                to={sport.href}
                className="rounded-lg bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <span className="mb-3 block text-3xl">{sport.icon}</span>
                <h4 className="text-dark mb-2 text-lg font-bold">
                  {sport.name}
                </h4>
                <p className="text-sm text-gray-600">{sport.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Support CTA */}
      <section className="bg-primary py-16">
        <div className="container mx-auto px-8 text-center">
          <h3 className="text-h3 mb-4 text-white">
            Support Your Local Sports Club
          </h3>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80">
            As a registered charity, we rely on the generosity of our community
            to maintain our facilities and keep sport accessible for everyone.
          </p>
          <Link
            to={DONATE_URL}
            className="bg-cta hover:bg-cta-dark inline-block rounded-lg px-8 py-3.5 text-lg font-medium text-white transition-colors"
          >
            Donate Now
          </Link>
        </div>
      </section>
    </>
  );
}
