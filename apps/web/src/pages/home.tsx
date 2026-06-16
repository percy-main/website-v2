import { OptimisedImage } from "@/components/optimised-image.js";
import { SeasonLeaders } from "@/components/season-leaders.js";
import {
  Kicker,
  Reveal,
  SectionMast,
  StampLink,
} from "@/components/theme/bits.js";
import { Plate } from "@/components/theme/plate.js";
import { RisoHeading } from "@/components/theme/riso-heading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client.js";
import { getCategoryColor } from "@/lib/category-colors.js";
import {
  eventsListQueryOptions,
  newsListQueryOptions,
  parseEventMetadata,
  parseNewsMetadata,
} from "@/lib/content-queries.js";
import { getPriceId } from "@/lib/stripe-env.js";
import { usePeople, type PersonSummary } from "@/lib/use-people.js";
import { nextOccurrence } from "@percy-main/shared/content";
import { useQuery } from "@tanstack/react-query";
import { format, isAfter } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Link } from "react-router";

const DONATE_URL = `/purchase/${getPriceId("donation")}`;

const sports = [
  {
    name: "Cricket",
    description:
      "Men's, women's, and junior teams in the Northumberland & Tyneside Cricket League",
    href: "/cricket",
    icon: "\u{1F3CF}",
  },
  {
    name: "Football",
    description:
      "Grassroots football for the local community with Percy Main Amateurs FC",
    href: "/football",
    icon: "⚽",
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
    description: "A social running group for all abilities",
    href: "/running",
    icon: "\u{1F3C3}",
  },
] as const;

/** One news card on the homepage. */
interface HomeNewsItem {
  slug: string;
  title: string;
  date: Date;
  tags: string[];
  author: PersonSummary | undefined;
}

function HomeArticleCard({ article }: { article: HomeNewsItem }) {
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
      className="group relative block overflow-hidden border-2 border-[#1b2a55] bg-[#fbf3df] transition-transform duration-200 hover:-translate-y-[3px]"
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
          <span className="shrink-0 text-[13px] whitespace-nowrap text-[#5c5740] max-md:hidden">
            {format(article.date, "d MMM yyyy")}
          </span>
        </div>

        <h3 className="font-secondary m-0 text-[24px] leading-[0.95] tracking-wide text-[#1b2a55] uppercase transition-colors duration-150 group-hover:text-[#ef4a1e]">
          {article.title}
        </h3>

        <div className="mt-0.5 flex items-center justify-between border-t border-[#1b2a55]/15 pt-3">
          <div className="flex items-center gap-2.5">
            {article.author?.picture ? (
              <OptimisedImage
                picture={article.author.picture}
                alt={article.author.name}
                className="size-7 shrink-0 rounded-full object-cover"
                sizes="28px"
              />
            ) : (
              <div
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{
                  background: accentColor.bg,
                  color: accentColor.text,
                }}
              >
                {initials}
              </div>
            )}
            <span className="text-[13px] font-semibold text-[#1b2a55]">
              {article.author?.name}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

interface UpcomingItem {
  id: string;
  type: "game" | "event";
  when: string;
  displayName: string;
  home?: boolean;
  href: string;
}

function getTeamPriority(teamName: string): number {
  if (/1st/i.test(teamName)) return 2;
  if (/2nd/i.test(teamName)) return 1;
  return 0;
}

function UpcomingStrip() {
  const season = new Date().getFullYear();
  const { data: games } = useQuery({
    queryKey: ["games", season],
    queryFn: () =>
      callApi(api.GET("/api/games", { params: { query: { season } } })),
    staleTime: 5 * 60_000,
  });

  // DB-backed events (live content editing, #489).
  const { data: eventsData } = useQuery(eventsListQueryOptions());

  const items: UpcomingItem[] = (() => {
    const now = new Date();
    const upcoming: UpcomingItem[] = [];

    if (games) {
      for (const game of games) {
        if (!game.when || !isAfter(new Date(game.when), now)) continue;
        // Bind the club name's trailing token (typically "CC") to the word
        // before it with a non-breaking space, so a wrap moves the whole club
        // name to the next line rather than orphaning "CC" on its own.
        const opponent = game.opposition.club.name.replace(
          / (\S+)$/,
          "\u00A0$1",
        );
        upcoming.push({
          id: game.id,
          type: "game",
          when: game.when,
          displayName: `${game.team.name} vs ${opponent}`,
          home: game.home,
          href: `/calendar/game/${game.id}`,
        });
      }
    }

    for (const item of eventsData?.items ?? []) {
      const meta = parseEventMetadata(item.metadata);
      if (!meta) continue;
      // The next non-cancelled occurrence (the single future date for
      // one-off events, or nothing once a series has elapsed).
      const occ = nextOccurrence(meta, now);
      if (!occ) continue;
      upcoming.push({
        id: item.slug,
        type: "event",
        when: occ.start,
        displayName: item.title,
        href: `/calendar/event/${item.slug}?on=${occ.date}`,
      });
    }

    upcoming.sort((a, b) => {
      const dateA = new Date(a.when);
      const dateB = new Date(b.when);
      const sameDay = dateA.toDateString() === dateB.toDateString();

      if (sameDay) {
        if (a.type === "game" && b.type === "game") {
          const pa = getTeamPriority(a.displayName);
          const pb = getTeamPriority(b.displayName);
          return pb - pa;
        }
        return a.type === "game" ? 1 : -1;
      }

      return dateA.getTime() - dateB.getTime();
    });

    return upcoming.slice(0, 6);
  })();

  if (items.length === 0) return null;

  return (
    <Plate variant="orange" flush>
      <SectionMast
        title="What's On"
        note="Spectators always welcome."
        front="var(--fc-paper)"
        back="var(--fc-navy)"
        blend="normal"
      />
      <div className="fc-fixtures">
        {items.map((item) => (
          <Link key={item.id} to={item.href} className="fc-frow">
            <div className="fc-frow-date">
              {formatInTimeZone(new Date(item.when), "Europe/London", "EEE dd")}
              <br />
              {formatInTimeZone(new Date(item.when), "Europe/London", "MMM")}
            </div>
            <div>
              <div className="fc-frow-opp">{item.displayName}</div>
              <div className="fc-frow-meta">
                {item.type === "game" ? "Match" : "Club Event"} ·{" "}
                {formatInTimeZone(
                  new Date(item.when),
                  "Europe/London",
                  "h:mm a",
                )}
              </div>
            </div>
            <div className="fc-frow-tag">
              {item.type === "game" ? (item.home ? "Home" : "Away") : "Event"}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-7">
        <Link
          to="/calendar"
          className="font-secondary tracking-wide text-[#f1e5c9] uppercase hover:underline"
        >
          Full fixture list &rarr;
        </Link>
      </div>
    </Plate>
  );
}

function LatestNewsSection() {
  const { data, isError } = useQuery(newsListQueryOptions({ page: 1 }));
  const people = usePeople();

  const top5: HomeNewsItem[] =
    !isError && data
      ? data.items.map((item) => {
          const meta = parseNewsMetadata(item.metadata);
          return {
            slug: item.slug,
            title: item.title,
            date: new Date(item.publishedAt),
            tags: meta?.tags ?? [],
            author: meta?.authorSlug ? people.get(meta.authorSlug) : undefined,
          };
        })
      : [];

  if (top5.length === 0) return null;

  return (
    <Plate variant="paper" flush>
      <SectionMast title="Latest News" />

      <div className="grid gap-5 md:grid-cols-2">
        {top5.slice(0, 2).map((article) => (
          <HomeArticleCard key={article.slug} article={article} />
        ))}
      </div>

      {top5.length > 2 && (
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {top5.slice(2, 5).map((article) => (
            <HomeArticleCard key={article.slug} article={article} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <Link
          to="/news/1"
          className="font-secondary tracking-wide text-[#ef4a1e] uppercase hover:underline"
        >
          All the news &rarr;
        </Link>
      </div>
    </Plate>
  );
}

export function Component() {
  useDocumentMeta(null);
  return (
    <>
      {/* PLATE 01 — HERO */}
      <Plate variant="paper">
        <div className="fc-hero">
          <div className="fc-hero-head">
            <RisoHeading as="h1" className="text-[clamp(64px,12vw,168px)]">
              Percy Main
            </RisoHeading>
            <div className="fc-sub">
              Community <span className="o">Sports Club</span>
            </div>
          </div>
          <div className="fc-hero-figwrap" aria-hidden="true">
            <img
              src="/images/fc-hero-cricket.png"
              alt=""
              width={720}
              height={837}
              className="mx-auto block h-auto w-full max-w-[480px]"
              loading="eager"
            />
          </div>
          <div className="fc-hero-rest">
            <Reveal>
              <p className="fc-lede">
                Cricket, football, boxing and running - eleven a side or on your
                own two feet, there's a place for you at the Main.
              </p>
            </Reveal>
            <div className="fc-meta mt-6">
              <div>
                Founded
                <b>1860</b>
              </div>
              <div>
                Status
                <b>Charity</b>
              </div>
              <div>
                Home
                <b>North Shields</b>
              </div>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <StampLink to="/auth/register">Join the Club &rarr;</StampLink>
              <Link
                to="/charity/redevelopment"
                className="font-secondary border-b-2 border-[#1b2a55] pb-1 text-[18px] tracking-wide text-[#1b2a55] uppercase transition hover:border-[#ef4a1e] hover:text-[#ef4a1e]"
              >
                Our redevelopment plans
              </Link>
            </div>
          </div>
        </div>
      </Plate>

      {/* PLATE 02 — WHAT'S ON */}
      <UpcomingStrip />

      {/* PLATE 04 — THE NUMBERS */}
      <Plate variant="navy" flush>
        <SectionMast
          title="The Numbers"
          front="var(--fc-paper)"
          back="var(--fc-orange)"
          blend="normal"
        />
        <div className="fc-statlines">
          <SeasonLeaders />
        </div>
      </Plate>

      {/* PLATE 05 — LATEST */}
      <LatestNewsSection />

      {/* PLATE 05 — SPORT FOR EVERYONE + OUR SPORTS (folded together) */}
      <Plate variant="orange">
        <div className="fc-statement">
          <RisoHeading
            front="var(--fc-navy)"
            back="var(--fc-paper)"
            blend="normal"
          >
            Sport for
          </RisoHeading>
          <RisoHeading
            front="var(--fc-navy)"
            back="var(--fc-paper)"
            blend="normal"
          >
            Everyone
          </RisoHeading>
          <RisoHeading
            front="var(--fc-paper)"
            back="var(--fc-navy)"
            blend="normal"
          >
            At The Main.
          </RisoHeading>
        </div>
        <Reveal>
          <p className="fc-foot mt-8 mb-12 text-[#f1e5c9]">
            We&apos;re a registered charity, a pair of pitches, a gym, a ring,
            and a running route - all kept going by the people who turn up. Come
            and be one of them.
          </p>
        </Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {sports.map((sport) => (
            <Link key={sport.name} to={sport.href} className="fc-tile">
              <span className="block text-4xl">{sport.icon}</span>
              <span className="fc-tile-name">{sport.name}</span>
              <span className="block text-sm leading-snug">
                {sport.description}
              </span>
            </Link>
          ))}
        </div>
      </Plate>

      {/* JOIN / SUPPORT — cream, to stand apart from the navy footer below */}
      <Plate variant="paper" className="text-center">
        <Kicker className="mb-3">Wanted</Kicker>
        <RisoHeading as="h2" className="text-[clamp(48px,11vw,150px)]">
          Believers
        </RisoHeading>
        <Reveal>
          <p className="mx-auto mt-4 mb-8 max-w-[46ch] text-[17px] leading-relaxed font-medium text-[#1b2a55]">
            As a registered charity we rely on our community to keep the lights
            on and sport accessible to everyone. Lend a hand, or chip in.
          </p>
        </Reveal>
        <StampLink to={DONATE_URL}>Donate Now &rarr;</StampLink>
      </Plate>
    </>
  );
}
