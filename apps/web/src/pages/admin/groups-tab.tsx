import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { AddMemberModal } from "./groups-tab/add-member-modal";
import { NewGroupModal } from "./groups-tab/new-group-modal";

export function GroupsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedGroupId = searchParams.get("groupId");
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);

  const setSelectedGroup = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("groupId", id);
    else next.delete("groupId");
    setSearchParams(next, { replace: true });
  };

  const { data: groupsData, isLoading: groupsLoading } = useAuthedQuery({
    queryKey: ["admin", "user-groups"],
    queryFn: () => callApi(api.GET("/api/admin/user-groups")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-600">
          Groupings of members, orthogonal to membership type. Use to scope
          availability requests to a focused audience (e.g. senior players,
          womens players).
        </p>
        <Button onClick={() => setNewGroupOpen(true)}>New group</Button>
      </div>

      {groupsLoading ? (
        <div className="py-12 text-center text-stone-500">Loading…</div>
      ) : groupsData?.groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-stone-500">
            No groups yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groupsData?.groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              isOpen={selectedGroupId === group.id}
              onToggle={() =>
                setSelectedGroup(selectedGroupId === group.id ? null : group.id)
              }
              onAddMember={() => setAddMemberGroupId(group.id)}
            />
          ))}
        </div>
      )}

      <NewGroupModal
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onCreated={(id) => setSelectedGroup(id)}
      />

      {addMemberGroupId && (
        <AddMemberModal
          groupId={addMemberGroupId}
          open={true}
          onOpenChange={(open) => {
            if (!open) setAddMemberGroupId(null);
          }}
        />
      )}
    </div>
  );
}

interface GroupCardProps {
  group: {
    id: string;
    name: string;
    description: string | null;
    memberCount: number;
  };
  isOpen: boolean;
  onToggle: () => void;
  onAddMember: () => void;
}

function GroupCard({ group, isOpen, onToggle, onAddMember }: GroupCardProps) {
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{group.name}</CardTitle>
            {group.description && (
              <CardDescription>{group.description}</CardDescription>
            )}
          </div>
          <span className="text-sm text-stone-500">
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent>
          <GroupMembers groupId={group.id} onAddMember={onAddMember} />
        </CardContent>
      )}
    </Card>
  );
}

function GroupMembers({
  groupId,
  onAddMember,
}: {
  groupId: string;
  onAddMember: () => void;
}) {
  const qc = useQueryClient();
  const authedKey = useAuthedQueryKey();
  const { data: detailData, isLoading: detailLoading } = useAuthedQuery({
    queryKey: ["admin", "user-groups", "detail", groupId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/user-groups/{groupId}", {
          params: { path: { groupId } },
        }),
      ),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      callApi(
        api.DELETE("/api/admin/user-groups/{groupId}/members/{memberId}", {
          params: { path: { groupId, memberId } },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: authedKey(["admin", "user-groups"]),
      });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onAddMember}>
          Add member
        </Button>
      </div>
      {detailLoading ? (
        <div className="py-6 text-center text-sm text-stone-500">Loading…</div>
      ) : detailData?.members.length === 0 ? (
        <div className="py-6 text-center text-sm text-stone-500">
          No members yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {detailData?.members.map((m) => (
              <TableRow key={m.memberId}>
                <TableCell>{m.name ?? "—"}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(m.memberId)}
                    aria-label={`Remove ${m.name ?? m.email}`}
                  >
                    ×
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
