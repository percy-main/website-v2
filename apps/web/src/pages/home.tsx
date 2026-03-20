import { OptimisedImage } from "@/components/optimised-image.js";
import { SeasonLeaders } from "@/components/season-leaders.js";
import { api } from "@/lib/api.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import { getAllEvents } from "@/lib/events.js";
import { getPicture } from "@/lib/image-map.js";
import { allNews } from "@/lib/news.js";
import { getPriceId } from "@/lib/stripe-env.js";
import { useQuery } from "@tanstack/react-query";
import { format, isAfter } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useMemo } from "react";
import { Link } from "react-router";

const DONATE_URL = `/purchase/${getPriceId("donation")}`;
const heroPicture = getPicture("/images/pitch.png");

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

function HomeArticleCard({ article }: { article: (typeof allNews)[number] }) {
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
          <span className="text-text shrink-0 text-[13px] whitespace-nowrap opacity-45 max-md:hidden">
            {format(article.date, "d MMM yyyy")}
          </span>
        </div>

        <h3 className="font-secondary text-dark group-hover:text-primary m-0 text-[20px] leading-snug font-bold transition-colors duration-150">
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
            <span className="text-dark text-[13px] font-semibold">
              {article.author?.name}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

interface GameListItem {
  id: string;
  home: boolean;
  team: { id: string; name: string };
  opposition: { club: { name: string } };
  when: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
}

interface UpcomingItem {
  id: string;
  type: "game" | "event";
  when: string;
  displayName: string;
  home?: boolean;
  teamId?: string;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  href: string;
}

function getTeamPriority(teamName: string): number {
  if (/1st/i.test(teamName)) return 2;
  if (/2nd/i.test(teamName)) return 1;
  return 0;
}

function UpcomingStrip() {
  const season = new Date().getFullYear();
  const { data: games } = useQuery<GameListItem[]>({
    queryKey: ["games", season],
    queryFn: () => api.get(`/games?season=${season}`),
    staleTime: 5 * 60_000,
  });

  const items = useMemo((): UpcomingItem[] => {
    const now = new Date();
    const upcoming: UpcomingItem[] = [];

    if (games) {
      for (const game of games) {
        if (!game.when || !isAfter(new Date(game.when), now)) continue;
        upcoming.push({
          id: game.id,
          type: "game",
          when: game.when,
          displayName: `${game.team.name} vs ${game.opposition.club.name}`,
          home: game.home,
          teamId: game.team.id,
          sponsorName: game.sponsorName,
          sponsorLogoUrl: game.sponsorLogoUrl,
          href: `/calendar/game/${game.id}`,
        });
      }
    }

    for (const event of getAllEvents()) {
      if (!isAfter(new Date(event.when), now)) continue;
      upcoming.push({
        id: event.slug,
        type: "event",
        when: event.when,
        displayName: event.name,
        href: `/calendar/event/${event.slug}`,
      });
    }

    // v1 sort: date ascending, same-day tiebreak by team priority (1st XI first),
    // games after events on same day
    upcoming.sort((a, b) => {
      const dateA = new Date(a.when);
      const dateB = new Date(b.when);
      const sameDay = dateA.toDateString() === dateB.toDateString();

      if (sameDay) {
        // Both games: sort by team priority descending
        if (a.type === "game" && b.type === "game") {
          const pa = getTeamPriority(a.displayName);
          const pb = getTeamPriority(b.displayName);
          return pb - pa;
        }
        // Games after events on same day (v1 behaviour)
        return a.type === "game" ? 1 : -1;
      }

      return dateA.getTime() - dateB.getTime();
    });

    return upcoming.slice(0, 5);
  }, [games]);

  if (items.length === 0) return null;

  return (
    <section className="bg-white py-10">
      <div className="container mx-auto px-8">
        <h3 className="text-h4 mb-6 text-center">What&apos;s Coming Up Soon</h3>
        <div className="flex snap-x gap-4 overflow-x-auto pb-2 md:justify-center md:overflow-x-visible">
          {items.map((item) => (
            <Link
              key={item.id}
              to={item.href}
              className="flex min-w-[220px] snap-start flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="mb-2 gap-2">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-primary text-sm font-semibold">
                    {formatInTimeZone(
                      new Date(item.when),
                      "Europe/London",
                      "EEE dd MMM",
                    )}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {item.type === "game" && (
                      <span
                        className={
                          item.home
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        }
                      >
                        {item.home ? "H" : "A"}
                      </span>
                    )}
                    <span
                      className={
                        item.type === "game"
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                          : "rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                      }
                    >
                      {item.type === "game" ? "Match" : "Event"}
                    </span>
                  </div>
                </div>
                <p className="text-dark line-clamp-2 text-sm font-medium">
                  {item.displayName}
                </p>
                {item.when && (
                  <p className="mt-1 text-xs text-gray-500">
                    {formatInTimeZone(
                      new Date(item.when),
                      "Europe/London",
                      "h:mm a",
                    )}
                  </p>
                )}
              </div>
              {item.type === "game" &&
                (item.sponsorName ?? item.sponsorLogoUrl) && (
                  <div className="flex flex-col items-center gap-1 border-t border-gray-100 pt-2">
                    <span className="text-[10px] leading-tight text-gray-400">
                      Sponsored
                    </span>
                    {item.sponsorLogoUrl ? (
                      <img
                        src={item.sponsorLogoUrl}
                        alt={`Sponsored by ${item.sponsorName}`}
                        width="60"
                        height="24"
                        className="h-6 max-w-[60px] object-contain"
                      />
                    ) : (
                      <span className="h-6 text-[10px] leading-tight font-medium text-gray-500">
                        {item.sponsorName}
                      </span>
                    )}
                  </div>
                )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Component() {
  return (
    <>
      {/* Hero */}
      <section>
        <div className="relative">
          {heroPicture ? (
            <OptimisedImage
              picture={heroPicture}
              alt="The cricket pitch at Percy Main"
              className="h-96 w-full object-cover md:h-[32rem]"
              loading="eager"
              sizes="100vw"
            />
          ) : (
            <img
              className="h-96 w-full object-cover md:h-[32rem]"
              src="/images/pitch.png"
              alt="The cricket pitch at Percy Main"
            />
          )}
          <div className="absolute inset-0 bg-gray-900 opacity-55" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="mx-auto max-w-screen-xl px-4 pt-6 pb-16 lg:px-6">
              <div className="mx-auto max-w-screen-md text-center">
                <h2 className="text-h2 md:text-h1 mb-4 leading-tight font-extrabold tracking-tight text-white">
                  Sport For Everyone At The Main
                </h2>
                <p className="mb-12 text-lg text-balance text-white/90 md:text-xl">
                  Community cricket, football, boxing, and running in the heart
                  of North Shields
                </p>
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                  <Link
                    to="/auth/register"
                    className="bg-cta hover:bg-cta-dark inline-block rounded-lg px-8 py-3.5 text-lg font-medium text-white transition-colors"
                  >
                    Join The Club
                  </Link>
                  <Link
                    to="/charity/redevelopment"
                    className="inline-block rounded-lg border-2 border-white/80 px-8 py-3.5 text-lg font-medium text-white transition-colors hover:bg-white/10"
                  >
                    See Our Redevelopment Plans
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute right-0 bottom-0 left-0 bg-black/40 backdrop-blur-sm">
            <div className="container grid grid-cols-2 divide-x divide-white/20 py-3 text-center text-sm text-white/90 md:text-base">
              <span className="font-medium">Est. 1860</span>
              <span className="font-medium">Registered Charity</span>
            </div>
          </div>
        </div>
      </section>

      {/* Upcoming Fixtures */}
      <UpcomingStrip />

      {/* Season Leaders */}
      <section className="bg-primary/5 py-10">
        <div className="container mx-auto px-8">
          <SeasonLeaders />
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
                className="text-primary hover:text-primary-light text-sm font-medium transition"
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
