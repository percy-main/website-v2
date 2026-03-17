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
import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { StatusPill } from "./status-pill";

interface Member {
  id: string;
  name: string;
  email: string;
  play_cricket_id: string | null;
  contentful_entry_id: string | null;
}

interface Dependent {
  id: string;
  name: string;
  play_cricket_id: string | null;
}

interface RecordLinkingResponse {
  members: Member[];
  dependents: Dependent[];
}

type RecordType = "member" | "dependent";
type TypeFilter = "all" | "member" | "dependent";

interface UnifiedRecord {
  id: string;
  name: string;
  type: RecordType;
  play_cricket_id: string | null;
  contentful_entry_id: string | null;
  email?: string;
}

function isFullyLinked(record: UnifiedRecord): boolean {
  if (record.type === "dependent") {
    return record.play_cricket_id !== null;
  }
  return record.play_cricket_id !== null && record.contentful_entry_id !== null;
}

export function RecordLinkingTab() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showFullyLinked, setShowFullyLinked] = useState(true);
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedRecord, setSelectedRecord] = useState<UnifiedRecord | null>(
    null,
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data } = useQuery({
    queryKey: ["admin", "recordLinking"],
    queryFn: () => api.get<RecordLinkingResponse>("/admin/record-linking"),
  });

  const allRecords: UnifiedRecord[] = useMemo(() => {
    if (!data) return [];
    const memberRecords: UnifiedRecord[] = data.members.map((m) => ({
      id: m.id,
      name: m.name,
      type: "member" as const,
      play_cricket_id: m.play_cricket_id,
      contentful_entry_id: m.contentful_entry_id,
      email: m.email,
    }));
    const depRecords: UnifiedRecord[] = data.dependents.map((d) => ({
      id: d.id,
      name: d.name,
      type: "dependent" as const,
      play_cricket_id: d.play_cricket_id,
      contentful_entry_id: null,
    }));
    return [...memberRecords, ...depRecords];
  }, [data]);

  const filteredRecords = useMemo(() => {
    let records = allRecords;

    if (debouncedSearch) {
      const search = debouncedSearch.toLowerCase();
      records = records.filter((r) => r.name.toLowerCase().includes(search));
    }

    if (typeFilter !== "all") {
      records = records.filter((r) => r.type === typeFilter);
    }

    records = records.filter((r) => {
      const linked = isFullyLinked(r);
      if (linked && showFullyLinked) return true;
      if (!linked && showUnlinked) return true;
      return false;
    });

    return records;
  }, [allRecords, debouncedSearch, typeFilter, showFullyLinked, showUnlinked]);

  // Stats
  const totalMembers = data?.members.length ?? 0;
  const linkedPlayCricketMembers =
    data?.members.filter((m) => m.play_cricket_id !== null).length ?? 0;
  const totalDependents = data?.dependents.length ?? 0;
  const linkedPlayCricketDeps =
    data?.dependents.filter((d) => d.play_cricket_id !== null).length ?? 0;
  const linkedContentfulMembers =
    data?.members.filter((m) => m.contentful_entry_id !== null).length ?? 0;

  // Play-Cricket link/unlink
  const linkPlayCricketMutation = useMutation({
    mutationFn: (body: {
      type: RecordType;
      id: string;
      playCricketId: string;
    }) => api.post("/admin/record-linking/play-cricket/link", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  const unlinkPlayCricketMutation = useMutation({
    mutationFn: (body: { type: RecordType; id: string }) =>
      api.post("/admin/record-linking/play-cricket/unlink", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  // Contentful link/unlink
  const linkContentfulMutation = useMutation({
    mutationFn: (body: { memberId: string; contentfulEntryId: string }) =>
      api.post("/admin/record-linking/contentful/link", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  const unlinkContentfulMutation = useMutation({
    mutationFn: (body: { memberId: string }) =>
      api.post("/admin/record-linking/contentful/unlink", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "recordLinking"],
      });
    },
  });

  // Keep selected record in sync with data after mutations
  const currentSelected = useMemo(() => {
    if (!selectedRecord) return null;
    return (
      allRecords.find(
        (r) => r.id === selectedRecord.id && r.type === selectedRecord.type,
      ) ?? selectedRecord
    );
  }, [allRecords, selectedRecord]);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Members</div>
          <div className="text-lg font-semibold">{totalMembers}</div>
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Play-Cricket</div>
          <div className="text-lg font-semibold">
            {linkedPlayCricketMembers}/{totalMembers} members,{" "}
            {linkedPlayCricketDeps}/{totalDependents} juniors
          </div>
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Contentful</div>
          <div className="text-lg font-semibold">
            {linkedContentfulMembers}/{totalMembers} linked
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by name..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64"
        />

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={showFullyLinked}
            onChange={(e) => setShowFullyLinked(e.target.checked)}
          />
          Fully linked
        </label>

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={showUnlinked}
            onChange={(e) => setShowUnlinked(e.target.checked)}
          />
          Unlinked
        </label>

        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as TypeFilter)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="member">Members only</SelectItem>
            <SelectItem value="dependent">Juniors only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-center">Play-Cricket</TableHead>
            <TableHead className="text-center">Contentful</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRecords.map((record) => (
            <TableRow
              key={`${record.type}-${record.id}`}
              className="cursor-pointer"
              onClick={() => setSelectedRecord(record)}
            >
              <TableCell className="font-medium">{record.name}</TableCell>
              <TableCell>
                {record.type === "member" ? (
                  <StatusPill variant="blue">Member</StatusPill>
                ) : (
                  <StatusPill variant="green">Junior</StatusPill>
                )}
              </TableCell>
              <TableCell className="text-center">
                {record.play_cricket_id ? (
                  <span className="text-green-600">&#10003;</span>
                ) : (
                  <span className="text-gray-400">&#10007;</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                {record.type === "dependent" ? (
                  <span className="text-gray-400">&mdash;</span>
                ) : record.contentful_entry_id ? (
                  <span className="text-green-600">&#10003;</span>
                ) : (
                  <span className="text-gray-400">&#10007;</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {filteredRecords.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-12 text-center text-gray-500"
              >
                No records found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Detail Dialog */}
      <Dialog
        open={currentSelected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRecord(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentSelected?.name}</DialogTitle>
          </DialogHeader>
          {currentSelected && (
            <DetailDialogContent
              record={currentSelected}
              onLinkPlayCricket={(playCricketId) =>
                linkPlayCricketMutation.mutate({
                  type: currentSelected.type,
                  id: currentSelected.id,
                  playCricketId,
                })
              }
              onUnlinkPlayCricket={() =>
                unlinkPlayCricketMutation.mutate({
                  type: currentSelected.type,
                  id: currentSelected.id,
                })
              }
              onLinkContentful={(contentfulEntryId) =>
                linkContentfulMutation.mutate({
                  memberId: currentSelected.id,
                  contentfulEntryId,
                })
              }
              onUnlinkContentful={() =>
                unlinkContentfulMutation.mutate({
                  memberId: currentSelected.id,
                })
              }
              isLinkingPlayCricket={linkPlayCricketMutation.isPending}
              isUnlinkingPlayCricket={unlinkPlayCricketMutation.isPending}
              isLinkingContentful={linkContentfulMutation.isPending}
              isUnlinkingContentful={unlinkContentfulMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailDialogContent({
  record,
  onLinkPlayCricket,
  onUnlinkPlayCricket,
  onLinkContentful,
  onUnlinkContentful,
  isLinkingPlayCricket,
  isUnlinkingPlayCricket,
  isLinkingContentful,
  isUnlinkingContentful,
}: {
  record: UnifiedRecord;
  onLinkPlayCricket: (playCricketId: string) => void;
  onUnlinkPlayCricket: () => void;
  onLinkContentful: (contentfulEntryId: string) => void;
  onUnlinkContentful: () => void;
  isLinkingPlayCricket: boolean;
  isUnlinkingPlayCricket: boolean;
  isLinkingContentful: boolean;
  isUnlinkingContentful: boolean;
}) {
  const [playCricketInput, setPlayCricketInput] = useState("");
  const [contentfulInput, setContentfulInput] = useState("");

  return (
    <div className="space-y-6">
      {/* Play-Cricket Section */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Play-Cricket</h3>
        {record.play_cricket_id ? (
          <div className="flex items-center gap-2">
            <StatusPill variant="green">Linked</StatusPill>
            <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-sm">
              #{record.play_cricket_id}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              disabled={isUnlinkingPlayCricket}
              onClick={onUnlinkPlayCricket}
            >
              Unlink
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <StatusPill variant="gray">Not linked</StatusPill>
            <Input
              placeholder="Play Cricket ID"
              value={playCricketInput}
              onChange={(e) => setPlayCricketInput(e.target.value)}
              className="w-48"
            />
            <Button
              size="sm"
              disabled={!playCricketInput.trim() || isLinkingPlayCricket}
              onClick={() => {
                onLinkPlayCricket(playCricketInput.trim());
                setPlayCricketInput("");
              }}
            >
              Link
            </Button>
          </div>
        )}
      </div>

      {/* Contentful Section (members only) */}
      {record.type === "member" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Contentful Profile</h3>
          {record.contentful_entry_id ? (
            <div className="flex items-center gap-2">
              <StatusPill variant="green">Linked</StatusPill>
              <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-sm">
                {record.contentful_entry_id}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                disabled={isUnlinkingContentful}
                onClick={onUnlinkContentful}
              >
                Unlink
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <StatusPill variant="gray">Not linked</StatusPill>
              <Input
                placeholder="Contentful Entry ID"
                value={contentfulInput}
                onChange={(e) => setContentfulInput(e.target.value)}
                className="w-48"
              />
              <Button
                size="sm"
                disabled={!contentfulInput.trim() || isLinkingContentful}
                onClick={() => {
                  onLinkContentful(contentfulInput.trim());
                  setContentfulInput("");
                }}
              >
                Link
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
