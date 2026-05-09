import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  buildPlayerNameMap,
  filterPeople,
  rankPlayCricketSuggestions,
  summarisePersonStats,
  type PersonRow,
  type PlayCricketPlayer,
} from "./record-linking-tab.lib";
import { StatusPill } from "./status-pill";

interface DetailModalState {
  person: PersonRow;
  linking: boolean;
}

export function RecordLinkingTab() {
  const queryClient = useQueryClient();
  const [pcPlayers, setPcPlayers] = useState<PlayCricketPlayer[] | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [showLinked, setShowLinked] = useState(true);
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [personTypeFilter, setPersonTypeFilter] = useState<
    "all" | "member" | "dependent"
  >("all");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: linkingData, isLoading } = useQuery({
    queryKey: ["admin", "recordLinking"],
    queryFn: () => callApi(api.GET("/api/admin/record-linking")),
  });

  // Fire-and-forget: this is a GET that loads the Play Cricket player list
  // into local state; no cached data is mutated.
  const refreshMutation = useMutation({
    mutationFn: () => callApi(api.GET("/api/admin/play-cricket-players")),
    onSuccess: (result) => {
      setPcPlayers(result.players as PlayCricketPlayer[]);
    },
  });

  const linkPcMutation = useMutation({
    mutationFn: (params: {
      type: "member" | "dependent";
      id: string;
      playCricketId: string;
    }) =>
      callApi(
        api.POST("/api/admin/record-linking/play-cricket/link", {
          body: params,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
      setDetailModal((prev) => (prev ? { ...prev, linking: false } : null));
      setLinkSearch("");
    },
  });

  const unlinkPcMutation = useMutation({
    mutationFn: (params: { type: "member" | "dependent"; id: string }) =>
      callApi(
        api.POST("/api/admin/record-linking/play-cricket/unlink", {
          body: params,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  const linkSlugMutation = useMutation({
    mutationFn: (params: { memberId: string; slug: string }) =>
      callApi(
        api.POST("/api/admin/record-linking/slug/link", { body: params }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  const unlinkSlugMutation = useMutation({
    mutationFn: (params: { memberId: string }) =>
      callApi(
        api.POST("/api/admin/record-linking/slug/unlink", { body: params }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  // Combine members and dependents into a single list
  const allPeople: PersonRow[] = linkingData
    ? [
        ...linkingData.members.map<PersonRow>((m) => ({
          id: m.id,
          name: m.name,
          playCricketId: m.play_cricket_id,
          slug: m.slug,
          type: "member" as const,
        })),
        ...linkingData.dependents.map<PersonRow>((d) => ({
          id: d.id,
          name: d.name,
          parentName: d.parentName,
          playCricketId: d.play_cricket_id,
          type: "dependent" as const,
        })),
      ]
    : [];

  const filteredPeople = filterPeople(allPeople, {
    search: debouncedSearch,
    showLinked,
    showUnlinked,
    personTypeFilter,
  });

  const { totalMembers, totalDependents, linkedPcMembers, linkedPcDeps } =
    summarisePersonStats(allPeople);

  const playerNameById = buildPlayerNameMap(pcPlayers);

  // Keep detail modal person in sync with linkingData refreshes
  useEffect(() => {
    if (detailModal && linkingData) {
      const updated = allPeople.find(
        (p) =>
          p.id === detailModal.person.id && p.type === detailModal.person.type,
      );
      if (updated) {
        setDetailModal((prev) => (prev ? { ...prev, person: updated } : null));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same pattern as v1
  }, [allPeople]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
            <span className="text-stone-500">Members:</span>{" "}
            <span className="font-medium">{totalMembers}</span>
          </div>
          <div className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
            <span className="text-stone-500">Play-Cricket:</span>{" "}
            <span className="font-medium">
              {linkedPcMembers}/{totalMembers}
            </span>{" "}
            <span className="text-stone-400">members</span>
            {totalDependents > 0 && (
              <>
                {", "}
                <span className="font-medium">
                  {linkedPcDeps}/{totalDependents}
                </span>{" "}
                <span className="text-stone-400">juniors</span>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            size="sm"
            variant="outline"
          >
            {refreshMutation.isPending
              ? "Fetching…"
              : pcPlayers
                ? "Refresh PC Players"
                : "Load PC Players"}
          </Button>
        </div>
      </div>

      {refreshMutation.isError && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to fetch Play-Cricket players. Please try again.
        </div>
      )}

      {!pcPlayers && !refreshMutation.isPending && (
        <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          Click &quot;Load PC Players&quot; to fetch the Play-Cricket player
          list. This is needed to link Play-Cricket records.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <Input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showLinked}
              onChange={(e) => setShowLinked(e.target.checked)}
            />
            Fully linked
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showUnlinked}
              onChange={(e) => setShowUnlinked(e.target.checked)}
            />
            Unlinked
          </label>
        </div>
        <Select
          value={personTypeFilter}
          onValueChange={(value) =>
            setPersonTypeFilter(value as "all" | "member" | "dependent")
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="member">Members only</SelectItem>
            <SelectItem value="dependent">Juniors only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading && <p className="text-stone-500">Loading…</p>}

      {linkingData && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-center">Play-Cricket</TableHead>
              <TableHead className="text-center">Slug</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPeople.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-6 text-center text-stone-500"
                >
                  No matching people found.
                </TableCell>
              </TableRow>
            )}
            {filteredPeople.map((person) => (
              <TableRow
                key={`${person.type}-${person.id}`}
                className="cursor-pointer"
                onClick={() => setDetailModal({ person, linking: false })}
              >
                <TableCell>
                  <div className="font-medium">{person.name}</div>
                  {person.parentName && (
                    <div className="text-xs text-stone-500">
                      Parent: {person.parentName}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill
                    variant={person.type === "member" ? "blue" : "green"}
                  >
                    {person.type === "member" ? "Member" : "Junior"}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-center">
                  {person.playCricketId ? (
                    <span
                      className="inline-block text-green-600"
                      title={`PC #${person.playCricketId}${playerNameById.get(person.playCricketId) ? ` - ${playerNameById.get(person.playCricketId)}` : ""}`}
                    >
                      &#10003;
                    </span>
                  ) : (
                    <span className="inline-block text-stone-300">
                      &#10007;
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {person.slug ? (
                    <span
                      className="inline-block text-green-600"
                      title={person.slug}
                    >
                      &#10003;
                    </span>
                  ) : (
                    <span className="inline-block text-stone-300">
                      {person.type === "member" ? "\u2717" : "\u2014"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Detail Modal */}
      {detailModal && (
        <DetailModal
          person={detailModal.person}
          linking={detailModal.linking}
          pcPlayers={pcPlayers}
          playerNameById={playerNameById}
          linkSearch={linkSearch}
          onLinkSearchChange={setLinkSearch}
          onStartLinking={() => {
            setDetailModal((prev) =>
              prev ? { ...prev, linking: true } : null,
            );
            setLinkSearch("");
          }}
          onCancelLinking={() => {
            setDetailModal((prev) =>
              prev ? { ...prev, linking: false } : null,
            );
            setLinkSearch("");
          }}
          onLinkPlayCricket={(playCricketId) =>
            linkPcMutation.mutate({
              type: detailModal.person.type,
              id: detailModal.person.id,
              playCricketId,
            })
          }
          onUnlinkPlayCricket={() =>
            unlinkPcMutation.mutate({
              type: detailModal.person.type,
              id: detailModal.person.id,
            })
          }
          isLinking={linkPcMutation.isPending}
          isUnlinking={unlinkPcMutation.isPending}
          onLinkSlug={(slug) =>
            linkSlugMutation.mutate({
              memberId: detailModal.person.id,
              slug,
            })
          }
          onUnlinkSlug={() =>
            unlinkSlugMutation.mutate({
              memberId: detailModal.person.id,
            })
          }
          isLinkingSlug={linkSlugMutation.isPending}
          isUnlinkingSlug={unlinkSlugMutation.isPending}
          onClose={() => {
            setDetailModal(null);
            setLinkSearch("");
          }}
        />
      )}
    </div>
  );
}

function DetailModal({
  person,
  linking,
  pcPlayers,
  playerNameById,
  linkSearch,
  onLinkSearchChange,
  onStartLinking,
  onCancelLinking,
  onLinkPlayCricket,
  onUnlinkPlayCricket,
  isLinking,
  isUnlinking,
  onLinkSlug,
  onUnlinkSlug,
  isLinkingSlug,
  isUnlinkingSlug,
  onClose,
}: {
  person: PersonRow;
  linking: boolean;
  pcPlayers: PlayCricketPlayer[] | null;
  playerNameById: Map<string, string>;
  linkSearch: string;
  onLinkSearchChange: (value: string) => void;
  onStartLinking: () => void;
  onCancelLinking: () => void;
  onLinkPlayCricket: (playCricketId: string) => void;
  onUnlinkPlayCricket: () => void;
  isLinking: boolean;
  isUnlinking: boolean;
  onLinkSlug: (slug: string) => void;
  onUnlinkSlug: () => void;
  isLinkingSlug: boolean;
  isUnlinkingSlug: boolean;
  onClose: () => void;
}) {
  const [slugInput, setSlugInput] = useState("");
  const suggestedPcPlayers =
    pcPlayers && linking
      ? rankPlayCricketSuggestions(pcPlayers, person.name, linkSearch)
      : [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{person.name}</DialogTitle>
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <StatusPill variant={person.type === "member" ? "blue" : "green"}>
              {person.type === "member" ? "Member" : "Junior"}
            </StatusPill>
            {person.parentName && <span>Parent: {person.parentName}</span>}
          </div>
        </DialogHeader>

        {/* Play-Cricket section */}
        <div className="rounded border border-stone-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-stone-700">
            Play-Cricket
          </h3>
          {person.playCricketId ? (
            <div className="flex items-center justify-between">
              <div>
                <StatusPill variant="green">Linked</StatusPill>
                <span className="ml-2 font-mono text-xs text-stone-500">
                  #{person.playCricketId}
                </span>
                {playerNameById.get(person.playCricketId) && (
                  <span className="ml-1 text-sm text-stone-700">
                    {playerNameById.get(person.playCricketId)}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onUnlinkPlayCricket}
                disabled={isUnlinking}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                Unlink
              </Button>
            </div>
          ) : linking ? (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Search Play-Cricket players…"
                  value={linkSearch}
                  onChange={(e) => onLinkSearchChange(e.target.value)}
                  className="flex-1"
                />
                <Button variant="ghost" size="sm" onClick={onCancelLinking}>
                  Cancel
                </Button>
              </div>
              {!pcPlayers && (
                <p className="text-sm text-yellow-600">
                  Load Play-Cricket players first using the button above.
                </p>
              )}
              <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                {suggestedPcPlayers.length === 0 && pcPlayers && (
                  <p className="py-2 text-center text-sm text-stone-500">
                    No matching players found.
                  </p>
                )}
                {suggestedPcPlayers.map((player) => (
                  <div
                    key={player.memberId}
                    className="flex items-center justify-between rounded px-3 py-2 hover:bg-stone-50"
                  >
                    <div>
                      <span className="font-medium">{player.name}</span>
                      <span className="ml-2 font-mono text-xs text-stone-400">
                        #{player.memberId}
                      </span>
                      {player.score >= 0.7 && (
                        <StatusPill variant="green">Strong match</StatusPill>
                      )}
                      {player.score >= 0.4 && player.score < 0.7 && (
                        <StatusPill variant="yellow">Possible match</StatusPill>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        onLinkPlayCricket(player.memberId.toString())
                      }
                      disabled={isLinking}
                    >
                      Link
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <StatusPill variant="gray">Not linked</StatusPill>
              <Button
                variant="outline"
                size="sm"
                onClick={onStartLinking}
                disabled={!pcPlayers}
                title={
                  !pcPlayers ? "Load Play-Cricket players first" : undefined
                }
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                Link
              </Button>
            </div>
          )}
        </div>

        {/* Slug section (members only) */}
        {person.type === "member" && (
          <div className="rounded border border-stone-200 p-4">
            <h3 className="mb-2 text-sm font-semibold text-stone-700">
              Person Page Slug
            </h3>
            {person.slug ? (
              <div className="flex items-center justify-between">
                <div>
                  <StatusPill variant="green">Linked</StatusPill>
                  <span className="ml-2 font-mono text-xs text-stone-500">
                    {person.slug}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onUnlinkSlug}
                  disabled={isUnlinkingSlug}
                  className="border-red-300 text-red-700 hover:bg-red-50"
                >
                  Unlink
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="e.g. alex-young"
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value)}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (slugInput.trim()) {
                      onLinkSlug(slugInput.trim());
                      setSlugInput("");
                    }
                  }}
                  disabled={!slugInput.trim() || isLinkingSlug}
                  className="border-blue-300 text-blue-700 hover:bg-blue-50"
                  variant="outline"
                >
                  Link
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
