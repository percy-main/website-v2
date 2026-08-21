import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useHasAdminPanelAccess } from "@/hooks/use-has-permission.js";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen";
import { useSession } from "@/lib/auth-client";
import { useAuthedQuery } from "@/lib/authed-query.js";
import { format } from "date-fns";
import { useState } from "react";
import { Link } from "react-router";

type Player =
  paths["/api/junior/teams/{teamId}/players"]["get"]["responses"]["200"]["content"]["application/json"][number];

type PlayerDetail =
  paths["/api/junior/players/{dependentId}"]["get"]["responses"]["200"]["content"]["application/json"];

function useTeams() {
  return useAuthedQuery({
    queryKey: ["juniorManager", "myTeams"],
    queryFn: () => callApi(api.GET("/api/junior/teams")),
  });
}

function usePlayers(teamId: string, enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["juniorManager", "players", teamId],
    queryFn: () =>
      callApi(
        api.GET("/api/junior/teams/{teamId}/players", {
          params: { path: { teamId } },
        }),
      ),
    enabled,
  });
}

export function Component() {
  useDocumentMeta("Junior Teams");
  const { data: session } = useSession();
  const hasAdminAccess = useHasAdminPanelAccess();

  if (!session) return null;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1>Junior Teams</h1>
          <div className="flex gap-2">
            {hasAdminAccess && (
              <Link
                className="rounded border border-stone-800 px-4 py-2 text-sm text-stone-900 hover:bg-stone-200"
                to="/admin"
              >
                Admin Panel
              </Link>
            )}
            <Link
              className="rounded border border-stone-800 px-4 py-2 text-sm text-stone-900 hover:bg-stone-200"
              to="/members"
            >
              Members Area
            </Link>
          </div>
        </div>
        <TeamsDashboard />
      </div>
    </div>
  );
}

function TeamsDashboard() {
  const { data: teams, isPending, isError } = useTeams();

  if (isPending) {
    return <p className="text-stone-500">Loading teams…</p>;
  }

  if (isError) {
    return <p className="text-red-600">Failed to load teams.</p>;
  }

  if (!teams || teams.length === 0) {
    return (
      <p className="text-stone-500">
        You have not been assigned to any teams. Contact an admin to get access.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {teams.map((team) => (
        <TeamCard key={team.id} teamId={team.id} teamName={team.name} />
      ))}
    </div>
  );
}

function TeamCard({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { data: players, isPending, isError } = usePlayers(teamId, true);

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2">
          {teamName}
          {players && <Badge variant="secondary">{players.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending && (
          <p className="text-sm text-stone-500">Loading players…</p>
        )}
        {isError && (
          <p className="text-sm text-red-600">Failed to load players.</p>
        )}
        {players && players.length > 0 && <PlayersTable players={players} />}
      </CardContent>
    </Card>
  );
}

function PlayersTable({ players }: { players: Player[] }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>DOB</TableHead>
            <TableHead>Parent</TableHead>
            <TableHead className="hidden sm:table-cell">Contact</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.map((player) => (
            <TableRow
              key={player.id}
              className="cursor-pointer hover:bg-stone-50"
              onClick={() => setSelectedPlayerId(player.id)}
            >
              <TableCell className="font-medium">{player.name}</TableCell>
              <TableCell>{format(player.dob, "dd/MM/yyyy")}</TableCell>
              <TableCell>{player.parent_name}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <div className="flex flex-col gap-0.5 text-xs">
                  <span>{player.parent_email}</span>
                  <span>{player.parent_telephone}</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selectedPlayerId && (
        <PlayerDetailModal
          dependentId={selectedPlayerId}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </>
  );
}

function usePlayerDetail(dependentId: string) {
  return useAuthedQuery({
    queryKey: ["juniorManager", "playerDetail", dependentId],
    queryFn: () =>
      callApi(
        api.GET("/api/junior/players/{dependentId}", {
          params: { path: { dependentId } },
        }),
      ),
  });
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  if (children === null || children === undefined || children === "") {
    return null;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-stone-500">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-stone-700">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </div>
  );
}

function ContactRow({
  label,
  name,
  phone,
  email,
}: {
  label: string;
  name: string | null;
  phone: string | null;
  email?: string | null;
}) {
  if (!name && !phone && !email) return null;
  return (
    <div className="col-span-2 flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-stone-500">{label}</dt>
      <dd className="text-sm">
        <span>{name}</span>
        {phone && (
          <>
            {" \u2014 "}
            <a href={`tel:${phone}`} className="text-blue-600 hover:underline">
              {phone}
            </a>
          </>
        )}
        {email && (
          <>
            {" \u2014 "}
            <a
              href={`mailto:${email}`}
              className="text-blue-600 hover:underline"
            >
              {email}
            </a>
          </>
        )}
      </dd>
    </div>
  );
}

function ConsentRow({
  label,
  value,
  description,
}: {
  label: string;
  value: boolean | null;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-stone-500">{label}</dt>
      <dd className="text-sm">
        <span>{value ? "Yes" : "No"}</span>
        <p className="mt-0.5 text-xs text-stone-400">{description}</p>
      </dd>
    </div>
  );
}

function PlayerDetailModal({
  dependentId,
  onClose,
}: {
  dependentId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = usePlayerDetail(dependentId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {isLoading || !data ? (
          <div className="py-12 text-center text-stone-500">Loading…</div>
        ) : (
          <PlayerDetailContent player={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlayerDetailContent({ player }: { player: PlayerDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>{player.name}</DialogTitle>
      </DialogHeader>

      <DetailSection title="Emergency Contact">
        <ContactRow
          label="Parent / Guardian"
          name={player.parent_name}
          phone={player.parent_telephone}
          email={player.parent_email}
        />
        <ContactRow
          label="Alt Contact"
          name={player.alt_contact_name}
          phone={player.alt_contact_phone}
        />
        <ContactRow
          label="Emergency Contact"
          name={player.emergency_contact_name}
          phone={player.emergency_contact_telephone}
        />
      </DetailSection>

      <hr className="border-stone-200" />

      <DetailSection title="Health">
        <DetailRow label="GP Surgery">{player.gp_surgery}</DetailRow>
        <DetailRow label="GP Phone">
          {player.gp_phone && (
            <a
              href={`tel:${player.gp_phone}`}
              className="text-blue-600 hover:underline"
            >
              {player.gp_phone}
            </a>
          )}
        </DetailRow>
        <DetailRow label="Medical Info">{player.medical_info}</DetailRow>
        <DetailRow label="Disability">
          {player.has_disability ? (player.disability_type ?? "Yes") : "No"}
        </DetailRow>
      </DetailSection>

      <hr className="border-stone-200" />

      <DetailSection title="Details">
        <DetailRow label="Date of Birth">
          {format(player.dob, "dd/MM/yyyy")}
        </DetailRow>
        <DetailRow label="Sex">
          <span className="capitalize">{player.sex}</span>
        </DetailRow>
        <DetailRow label="School Year">{player.school_year}</DetailRow>
        <DetailRow label="Address">
          {player.parent_address}
          {player.parent_postcode && <>, {player.parent_postcode}</>}
        </DetailRow>
        <DetailRow label="Registered">
          {format(player.created_at, "dd/MM/yyyy")}
        </DetailRow>
      </DetailSection>

      <hr className="border-stone-200" />

      <DetailSection title="Cricket">
        <DetailRow label="Played Before">
          {player.played_before === null
            ? null
            : player.played_before
              ? "Yes"
              : "No"}
        </DetailRow>
        <DetailRow label="Previous Cricket">
          {player.previous_cricket}
        </DetailRow>
      </DetailSection>

      <hr className="border-stone-200" />

      <DetailSection title="Consents">
        <ConsentRow
          label="Emergency Medical Consent"
          value={player.emergency_medical_consent}
          description="Parent authorises emergency medical treatment if they cannot be reached"
        />
        <ConsentRow
          label="Medical Fitness Declaration"
          value={player.medical_fitness_declaration}
          description="Parent confirms the child is fit to participate in cricket"
        />
        <ConsentRow
          label="Photo Consent"
          value={player.photo_consent}
          description="Photos and videos may be used on the club website and social media"
        />
        <ConsentRow
          label="Data Protection"
          value={player.data_protection_consent}
          description="Personal data may be stored and used for club administration"
        />
        <ConsentRow
          label="WhatsApp Consent"
          value={player.whatsapp_consent}
          description="Parent can be contacted via WhatsApp for team updates"
        />
        {player.alt_contact_whatsapp_consent !== null && (
          <ConsentRow
            label="Alt Contact WhatsApp"
            value={player.alt_contact_whatsapp_consent}
            description="Alt contact can be contacted via WhatsApp for team updates"
          />
        )}
      </DetailSection>
    </div>
  );
}
