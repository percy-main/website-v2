import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Link } from "react-router";

interface Team {
  id: string;
  name: string;
  age_group: string;
  sex: string;
  created_at: string;
}

interface Player {
  id: string;
  name: string;
  sex: string;
  dob: string;
  created_at: string;
  school_year: string | null;
  played_before: string | null;
  medical_info: string | null;
  parent_name: string | null;
  parent_telephone: string | null;
  parent_email: string;
  parent_address: string | null;
  parent_postcode: string | null;
  emergency_contact_name: string | null;
  emergency_contact_telephone: string | null;
}

function useTeams() {
  return useQuery({
    queryKey: ["juniorManager", "myTeams"],
    queryFn: () => api.get<Team[]>("/junior/teams"),
  });
}

function usePlayers(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["juniorManager", "players", teamId],
    queryFn: () => api.get<Player[]>(`/junior/teams/${teamId}/players`),
    enabled,
  });
}

export function Component() {
  const { data: session } = useSession();

  if (!session) return null;

  const { user } = session;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1>Junior Teams</h1>
          <div className="flex gap-2">
            {user.role === "admin" && (
              <Link
                className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
                to="/admin"
              >
                Admin Panel
              </Link>
            )}
            <Link
              className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
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
    return <p className="text-gray-500">Loading teams...</p>;
  }

  if (isError) {
    return <p className="text-red-600">Failed to load teams.</p>;
  }

  if (!teams || teams.length === 0) {
    return (
      <p className="text-gray-500">
        You have not been assigned to any teams. Contact an admin to get access.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        You have access to {teams.length} team{teams.length !== 1 ? "s" : ""}.
        Select a team to view players.
      </p>
      {teams.map((team) => (
        <TeamCard key={team.id} teamId={team.id} teamName={team.name} />
      ))}
    </div>
  );
}

function TeamCard({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [expanded, setExpanded] = useState(false);
  const {
    data: players,
    isPending,
    isError,
    isSuccess,
  } = usePlayers(teamId, expanded);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {teamName}
            {players && <Badge variant="secondary">{players.length}</Badge>}
          </CardTitle>
          <span className="text-sm text-gray-400">
            {expanded ? "Collapse" : "Expand"}
          </span>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {isPending && (
            <p className="text-sm text-gray-500">Loading players...</p>
          )}
          {isError && (
            <p className="text-sm text-red-600">Failed to load players.</p>
          )}
          {isSuccess && players.length === 0 && (
            <p className="text-sm text-gray-500">
              No players registered in this team.
            </p>
          )}
          {players && players.length > 0 && <PlayersTable players={players} />}
        </CardContent>
      )}
    </Card>
  );
}

function PlayersTable({ players }: { players: Player[] }) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>DOB</TableHead>
          <TableHead>Parent</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.map((player) => (
          <>
            <TableRow key={player.id}>
              <TableCell className="font-medium">{player.name}</TableCell>
              <TableCell>{format(player.dob, "dd/MM/yyyy")}</TableCell>
              <TableCell>{player.parent_name}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5 text-xs">
                  <a
                    href={`mailto:${player.parent_email}`}
                    className="text-blue-600 hover:underline"
                  >
                    {player.parent_email}
                  </a>
                  <span>{player.parent_telephone}</span>
                </div>
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setExpandedPlayer(
                      expandedPlayer === player.id ? null : player.id,
                    )
                  }
                >
                  {expandedPlayer === player.id ? "Hide" : "View"}
                </Button>
              </TableCell>
            </TableRow>
            {expandedPlayer === player.id && (
              <TableRow key={`${player.id}-detail`}>
                <TableCell colSpan={5}>
                  <div className="rounded bg-gray-50 p-4">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="font-medium text-gray-500">Player Name</dt>
                      <dd>{player.name}</dd>
                      <dt className="font-medium text-gray-500">
                        Date of Birth
                      </dt>
                      <dd>{format(player.dob, "dd/MM/yyyy")}</dd>
                      <dt className="font-medium text-gray-500">Sex</dt>
                      <dd className="capitalize">{player.sex}</dd>
                      <dt className="font-medium text-gray-500">Registered</dt>
                      <dd>{format(player.created_at, "dd/MM/yyyy")}</dd>
                      <dt className="mt-3 font-medium text-gray-500">
                        Parent / Guardian
                      </dt>
                      <dd className="mt-3">{player.parent_name}</dd>
                      <dt className="font-medium text-gray-500">Email</dt>
                      <dd>
                        <a
                          href={`mailto:${player.parent_email}`}
                          className="text-blue-600 hover:underline"
                        >
                          {player.parent_email}
                        </a>
                      </dd>
                      <dt className="font-medium text-gray-500">Telephone</dt>
                      <dd>{player.parent_telephone}</dd>
                      <dt className="font-medium text-gray-500">Address</dt>
                      <dd>
                        {player.parent_address}
                        {player.parent_postcode && (
                          <>, {player.parent_postcode}</>
                        )}
                      </dd>
                      <dt className="mt-3 font-medium text-gray-500">
                        Emergency Contact
                      </dt>
                      <dd className="mt-3">{player.emergency_contact_name}</dd>
                      <dt className="font-medium text-gray-500">
                        Emergency Phone
                      </dt>
                      <dd>{player.emergency_contact_telephone}</dd>
                    </dl>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </>
        ))}
      </TableBody>
    </Table>
  );
}
