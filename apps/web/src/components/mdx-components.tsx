import { getPersonBySlug } from "@/lib/people.js";
import { Link } from "react-router";
import type { FC, ReactNode } from "react";

const ANON_IMAGE = "/images/anon.jpg";

function Person({ slug, role }: { slug: string; role?: string }) {
  const person = getPersonBySlug(slug);
  const name = person?.name ?? slug;
  const photo = person?.photo;

  return (
    <div className="person h-full rounded-lg bg-white pb-4 text-gray-900 shadow-md">
      <div className="h-2 rounded-t-lg bg-gradient-to-r from-cta to-orange-400" />
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
          className="mt-2 inline-block px-2 text-sm text-primary font-medium hover:underline"
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
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {children}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {slugs?.map((slug) => <Person key={slug} slug={slug} />)}
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
  return (
    <div className="my-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">
        League table: {name ?? divisionId} (loading from API...)
      </p>
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

function EventPreview({ id }: { id: string }) {
  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">Event preview: {id}</p>
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

function ContactForm() {
  return (
    <div className="my-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-gray-500">Contact form placeholder</p>
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
      <img
        src={src}
        alt={alt ?? ""}
        className="h-auto max-w-full rounded-lg"
      />
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
