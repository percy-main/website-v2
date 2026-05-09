import { LeaderboardContent } from "@/components/leaderboard-content.js";
import { OptimisedImage } from "@/components/optimised-image.js";
import { OutcomeBadge } from "@/components/outcome-badge.js";
import { RecordsWall as RecordsWallComponent } from "@/components/records-wall.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { api, callApi } from "@/lib/api-client.js";
import { getImageUrl, getPicture } from "@/lib/image-map.js";
import { getPersonBySlug } from "@/lib/people.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { type ReactNode, useState } from "react";
import { IoCalendar, IoChevronForward } from "react-icons/io5";
import { Link, useLocation } from "react-router";

const ANON_IMAGE = getImageUrl("/images/anon.jpg");
const ANON_PICTURE = getPicture("/images/anon.jpg");

function Leaderboard() {
  return <LeaderboardContent />;
}

function RecordsWall() {
  return <RecordsWallComponent />;
}

function Person({ slug, role }: { slug: string; role?: string }) {
  const person = getPersonBySlug(slug);
  const name = person?.name ?? slug;
  const picture = person?.photoPicture ?? ANON_PICTURE;

  return (
    <div className="person h-full rounded-lg bg-white pb-4 text-stone-900 shadow-md">
      <div className="from-cta h-2 rounded-t-lg bg-gradient-to-r to-orange-400" />
      <div className="mx-auto mt-4 size-24 overflow-hidden rounded-full border-4 border-stone-100">
        {picture ? (
          <OptimisedImage
            picture={picture}
            alt={name}
            className="size-24 object-cover object-center"
            sizes="96px"
          />
        ) : (
          <img
            className="size-24 object-cover object-center"
            src={person?.photo ?? ANON_IMAGE}
            alt={name}
          />
        )}
      </div>
      <div className="mt-3 text-center">
        <h5 className="pb-1 font-semibold">{name}</h5>
        {role && <p className="text-sm text-stone-600">{role}</p>}
        <Link
          to={`/person/${slug}`}
          className="text-primary mt-2 inline-block px-2 text-sm font-medium hover:underline"
        >
          Profile
        </Link>
      </div>
    </div>
  );
}

function PersonGrid({
  slugs,
  children,
}: {
  slugs?: string[];
  children?: ReactNode;
}) {
  if (children) {
    return (
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    );
  }
  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {slugs?.map((slug) => (
        <Person key={slug} slug={slug} />
      ))}
    </div>
  );
}

function LeagueTable({
  divisionId,
  name,
}: {
  divisionId: string;
  name?: string;
}) {
  const query = useQuery({
    queryKey: ["getLeagueTable", divisionId],
    queryFn: () =>
      callApi(
        api.GET("/api/play-cricket/league-table", {
          params: { query: { divisionId } },
        }),
      ),
  });

  if (!query.data) {
    return null;
  }

  const { columns, rows } = query.data;

  return (
    <div className="container mx-auto rounded-md p-2 sm:p-4 dark:bg-stone-50 dark:text-stone-800">
      <div className="mx-auto max-w-max rounded-lg bg-white p-4 shadow">
        <h2 className="mb-3 text-2xl leading-tight font-semibold">{name}</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="rounded-t-lg dark:bg-stone-300">
              <tr className="text-right">
                <th title="Position" className="p-3 text-left">
                  Position
                </th>
                {columns.map((column) => (
                  <th key={column} title={column} className="p-3 text-left">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="border border-red-50">
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-b-stone-200 odd:bg-red-50"
                >
                  <td className="px-3 py-2 text-left">
                    <span>{row.position}</span>
                  </td>
                  {columns.map((cell) => (
                    <td key={cell} className="px-3 py-2 text-left">
                      <span>{row[cell]}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EventPreview({
  id,
  name,
  when,
}: {
  id: string;
  name: string;
  when: string;
}) {
  const formatted = new Date(when).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="mb-2 h-full max-w-sm rounded-none bg-white p-4 shadow-md lg:rounded-lg">
      <div className="flex flex-col items-stretch justify-between">
        <div className="flex flex-row gap-4">
          <IoCalendar title="Event" fontSize={32} />
          <h4 className="text-lg font-semibold">{formatted}</h4>
        </div>
        <div className="mt-4 flex flex-row items-center justify-between gap-4">
          <p className="text-sm">{name}</p>
          <Link
            to={`/calendar/event/${id}`}
            className="flex flex-col items-center justify-center self-stretch"
          >
            <IoChevronForward
              className="text-stone-700 hover:text-stone-400"
              fontSize={32}
              aria-label="Read more about this event"
            />
          </Link>
        </div>
      </div>
    </div>
  );
}

// /api/games/{matchId} is not yet in the generated OpenAPI spec, so we keep
// local types and use a direct fetch until the spec is regenerated.
type Outcome = "W" | "L" | "D" | "T" | "A" | "C" | "N";

interface GameListItem {
  id: string;
  home: boolean;
  team: { name: string };
  opposition: {
    club: { name: string };
    team: { name: string };
  };
  league: { name: string };
  competition: { name: string };
  when: string | null;
  outcome: Outcome | null;
  scoreDescription: string | null;
  sponsorName: string | null;
}

async function fetchGame(matchId: string): Promise<GameListItem> {
  const res = await fetch(`/api/games/${matchId}`, { credentials: "include" });
  if (!res.ok) throw new Error(res.statusText);
  return res.json() as Promise<GameListItem>;
}

function GamePreview({ playCricketId }: { playCricketId: string }) {
  const { data: game, isLoading } = useQuery({
    queryKey: ["game", playCricketId],
    queryFn: () => fetchGame(playCricketId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="my-2 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-stone-500">Loading game…</p>
      </div>
    );
  }

  if (!game) {
    return null;
  }

  const dateStr = game.when
    ? formatInTimeZone(new Date(game.when), "Europe/London", "dd/MM/yyyy HH:mm")
    : "TBC";

  return (
    <Link
      to={`/calendar/game/${game.id}`}
      className={cn(
        "my-2 flex items-center gap-3 rounded-lg border-l-4 bg-white p-4 shadow-sm transition-all hover:translate-x-1 hover:shadow-md",
        game.home ? "border-l-green-800" : "border-l-blue-600",
      )}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-xs font-semibold",
            game.home
              ? "bg-green-100 text-green-800"
              : "bg-blue-100 text-blue-800",
          )}
        >
          {game.home ? "H" : "A"}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <span className="text-sm font-bold text-stone-900">
            {game.team.name}
          </span>
          <span className="text-sm text-stone-400">vs.</span>
          <span className="text-sm font-semibold text-stone-900">
            {game.opposition.club.name} {game.opposition.team.name}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-400">{dateStr}</span>
          <span className="text-xs text-stone-400">
            {game.league.name || game.competition.name}
          </span>
        </div>
      </div>
      {game.outcome && (
        <OutcomeBadge
          outcome={game.outcome}
          scoreDescription={game.scoreDescription ?? undefined}
        />
      )}
      <IoChevronForward className="size-5 shrink-0 text-stone-300" />
    </Link>
  );
}

function ContactForm({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: (input: {
      name: string;
      email: string;
      message: string;
      page: string;
    }) => callApi(api.POST("/api/contact", { body: input })),
  });

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-stone-900">
        {title}
      </h2>
      {mutation.isSuccess ? (
        <p className="mt-3 text-sm text-stone-600">
          Thanks for getting in touch! We'll get back to you soon.
        </p>
      ) : (
        <>
          {description ? (
            <p className="mt-1 text-sm text-stone-500">{description}</p>
          ) : null}
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                name,
                email,
                message,
                page: location.pathname,
              });
            }}
          >
            <label htmlFor="contact-name" className="sr-only">
              Name
            </label>
            <Input
              id="contact-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor="contact-email" className="sr-only">
              Email address
            </label>
            <Input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="Your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="contact-message" className="sr-only">
              Message
            </label>
            <Textarea
              id="contact-message"
              name="message"
              required
              rows={4}
              placeholder="Your message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Sending…" : "Send Message"}
            </Button>
          </form>
          {mutation.isError ? (
            <p className="mt-3 text-sm text-red-600">
              Sorry, something went wrong. Please try again.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ContentImage({
  src,
  alt,
  caption,
}: {
  src: string;
  alt?: string;
  caption?: string;
}) {
  const picture = getPicture(src);

  return (
    <figure className="my-4 max-w-lg self-center">
      {picture ? (
        <OptimisedImage
          picture={picture}
          alt={alt ?? ""}
          className="h-auto max-w-full rounded-lg"
          sizes="(max-width: 512px) 100vw, 512px"
        />
      ) : (
        <img
          src={src}
          alt={alt ?? ""}
          className="h-auto max-w-full rounded-lg"
        />
      )}
      {caption && (
        <figcaption className="mt-2 text-sm text-stone-600">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Component map provided to MDX content.
 * MDX files can use these as JSX tags: <Person slug="..." />, <LeagueTable divisionId="..." />, etc.
 */
/**
 * Override for markdown `![alt](src)` images in MDX.
 * Resolves image paths through the optimised image map.
 */
function MdxImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = props.src ?? "";
  const picture = getPicture(src);

  if (picture) {
    return (
      <OptimisedImage
        picture={picture}
        alt={props.alt ?? ""}
        className="h-auto max-w-full rounded-lg"
        sizes="(max-width: 512px) 100vw, 512px"
      />
    );
  }

  return <img {...props} alt={props.alt ?? ""} />;
}

/**
 * Component map provided to MDX content.
 * MDX files can use these as JSX tags: <Person slug="..." />, <LeagueTable divisionId="..." />, etc.
 */
export const mdxComponents = {
  Person,
  PersonGrid,
  LeagueTable,
  Leaderboard,
  RecordsWall,
  EventPreview,
  GamePreview,
  ContactForm,
  Image: ContentImage,
  img: MdxImg,
};
