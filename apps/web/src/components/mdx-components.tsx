import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { api } from "@/lib/api.js";
import { getPersonBySlug } from "@/lib/people.js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FC, type ReactNode, useState } from "react";
import { IoCalendar, IoChevronForward } from "react-icons/io5";
import { Link, useLocation } from "react-router";

const ANON_IMAGE = "/images/anon.jpg";

function Person({ slug, role }: { slug: string; role?: string }) {
  const person = getPersonBySlug(slug);
  const name = person?.name ?? slug;
  const photo = person?.photo;

  return (
    <div className="person h-full rounded-lg bg-white pb-4 text-gray-900 shadow-md">
      <div className="from-cta h-2 rounded-t-lg bg-gradient-to-r to-orange-400" />
      <div className="mx-auto mt-4 h-24 w-24 overflow-hidden rounded-full border-4 border-gray-100">
        <img
          className="h-24 w-24 object-cover object-center"
          src={photo ?? ANON_IMAGE}
          alt={name}
        />
      </div>
      <div className="mt-3 text-center">
        <h5 className="pb-1 font-semibold">{name}</h5>
        {role && <p className="text-sm text-gray-600">{role}</p>}
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

interface LeagueTableResponse {
  columns: string[];
  rows: Array<{ position: string; team_id: string } & Record<string, string>>;
}

function LeagueTable({
  divisionId,
  name,
}: {
  divisionId: string;
  name?: string;
}) {
  const query = useQuery<LeagueTableResponse>({
    queryKey: ["getLeagueTable", divisionId],
    queryFn: () =>
      api.get(`/play-cricket/league-table?divisionId=${divisionId}`),
  });

  if (!query.data) {
    return null;
  }

  const { columns, rows } = query.data;

  return (
    <div className="container mx-auto rounded-md p-2 sm:p-4 dark:bg-gray-50 dark:text-gray-800">
      <div className="mx-auto max-w-max rounded-lg bg-white p-4 shadow">
        <h2 className="mb-3 text-2xl leading-tight font-semibold">{name}</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="rounded-t-lg dark:bg-gray-300">
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
                  className="border-b border-b-gray-200 odd:bg-red-50"
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

function Leaderboard({
  discipline,
  category,
  limit,
}: {
  discipline?: string;
  category?: string;
  limit?: number;
}) {
  return (
    <div className="my-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">
        Leaderboard: {discipline ?? "all"} / {category ?? "seniors"} (top{" "}
        {limit ?? 10})
      </p>
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
              className="text-gray-700 hover:text-gray-400"
              fontSize={32}
              aria-label="Read more about this event"
            />
          </Link>
        </div>
      </div>
    </div>
  );
}

function GamePreview({ playCricketId }: { playCricketId: string }) {
  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">Game preview: {playCricketId}</p>
    </div>
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
    }) => api.post("/contact", input),
  });

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      {mutation.isSuccess ? (
        <p className="mt-3 text-sm text-gray-600">
          Thanks for getting in touch! We'll get back to you soon.
        </p>
      ) : (
        <>
          {description ? (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
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
              {mutation.isPending ? "Sending..." : "Send Message"}
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

function CollectEmail({ listId }: { listId?: string }) {
  return (
    <div className="my-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">
        Email signup placeholder{listId ? `: ${listId}` : ""}
      </p>
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
  return (
    <figure className="my-4 max-w-lg self-center">
      <img src={src} alt={alt ?? ""} className="h-auto max-w-full rounded-lg" />
      {caption && (
        <figcaption className="mt-2 text-sm text-gray-600">
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
export const mdxComponents: Record<string, FC<Record<string, unknown>>> = {
  Person: Person as FC<Record<string, unknown>>,
  PersonGrid: PersonGrid as FC<Record<string, unknown>>,
  LeagueTable: LeagueTable as FC<Record<string, unknown>>,
  Leaderboard: Leaderboard as FC<Record<string, unknown>>,
  EventPreview: EventPreview as FC<Record<string, unknown>>,
  GamePreview: GamePreview as FC<Record<string, unknown>>,
  ContactForm: ContactForm as FC<Record<string, unknown>>,
  CollectEmail: CollectEmail as FC<Record<string, unknown>>,
  Image: ContentImage as FC<Record<string, unknown>>,
};
