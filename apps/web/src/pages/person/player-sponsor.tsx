import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

interface SponsorData {
  id: string;
  sponsor_name: string;
  sponsor_website: string | null;
  sponsor_logo_url: string | null;
  sponsor_message: string | null;
  display_name: string | null;
}

export function PlayerSponsor({ slug }: { slug: string }) {
  const sponsorQuery = useQuery({
    queryKey: ["player-sponsor", slug],
    queryFn: () =>
      api.get<{ sponsor: SponsorData | null }>(`/sponsorship/player/${slug}`),
    staleTime: 5 * 60 * 1000,
  });

  const pendingQuery = useQuery({
    queryKey: ["player-sponsor-pending", slug],
    queryFn: () =>
      api.get<{ hasPending: boolean }>(`/sponsorship/player/${slug}/pending`),
    staleTime: 5 * 60 * 1000,
  });

  if (sponsorQuery.isPending) {
    return <div className="h-24 animate-pulse rounded-lg bg-gray-100" />;
  }

  const sponsor = sponsorQuery.data?.sponsor;

  // Show approved sponsor
  if (sponsor) {
    const displayName = sponsor.display_name ?? sponsor.sponsor_name;

    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="mb-2 text-xs font-medium tracking-wide text-green-700 uppercase">
          Sponsored by
        </p>
        {sponsor.sponsor_logo_url && (
          <img
            src={sponsor.sponsor_logo_url}
            alt={displayName}
            className="mb-2 max-w-[120px]"
          />
        )}
        {sponsor.sponsor_website ? (
          <a
            href={sponsor.sponsor_website}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-green-800 underline decoration-green-800/30 underline-offset-2 hover:decoration-green-800"
          >
            {displayName}
          </a>
        ) : (
          <p className="font-semibold text-green-800">{displayName}</p>
        )}
        {sponsor.sponsor_message && (
          <p className="mt-1 text-sm text-green-700 italic">
            {sponsor.sponsor_message}
          </p>
        )}
      </div>
    );
  }

  // Hide CTA if there's a pending sponsorship
  if (pendingQuery.data?.hasPending) {
    return null;
  }

  // Show CTA
  return (
    <Link
      to={`/person/sponsor/${slug}`}
      className="block rounded-lg border border-blue-200 bg-blue-50 p-4 transition hover:bg-blue-100"
    >
      <p className="font-semibold text-blue-800">Sponsor This Player</p>
      <p className="mt-1 text-sm text-blue-600">
        Support this player for the season
      </p>
    </Link>
  );
}
