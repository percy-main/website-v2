import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { parseRoles, type RoleName } from "@percy-main/shared/auth/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getRoleLabels } from "./member-detail-modal.lib";
import { StatusPill } from "./status-pill";

interface Item {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function AccessTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "access", "list"],
    queryFn: () => callApi(api.GET("/api/admin/access/users")),
  });

  const [editing, setEditing] = useState<Item | null>(null);
  const [adding, setAdding] = useState(false);

  if (isLoading) {
    return <p className="py-12 text-center text-stone-500">Loading…</p>;
  }
  if (error) {
    return (
      <p className="py-12 text-center text-red-600">
        Failed to load. You may not have access to this tab.
      </p>
    );
  }
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          Users with elevated permissions. The default <code>user</code> role is
          hidden; only people with any other role appear here.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add user
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">
          No users with elevated permissions yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="text-stone-600">{u.email}</TableCell>
                <TableCell>
                  <RoleChipList role={u.role} />
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditing({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: u.role,
                      })
                    }
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && (
        <EditRolesDialog user={editing} onClose={() => setEditing(null)} />
      )}
      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onPicked={(user) =>
            setEditing({
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role ?? "",
            })
          }
        />
      )}
    </div>
  );
}

function RoleChipList({ role }: { role: string }) {
  const labels = getRoleLabels(role);
  if (labels.length === 0) return <StatusPill variant="gray">User</StatusPill>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {labels.map(({ name, label }) => (
        <StatusPill
          key={name}
          variant={
            name === "admin" || name === "superadmin"
              ? "blue"
              : name === "junior_manager" || name === "official"
                ? "green"
                : "gray"
          }
        >
          {label}
        </StatusPill>
      ))}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Edit Roles Dialog — grid layout
// ────────────────────────────────────────────────────────────────────────

// Rows for the view/manage grid. Each entry maps to two role slugs.
const VIEW_MANAGE_ROWS = [
  {
    label: "Incidents (safeguarding + contact inbox)",
    viewer: "incidents_viewer",
    admin: "incidents_admin",
  },
  { label: "Documents", viewer: null, admin: "documents_admin" },
  {
    label: "Marketing (leads, contacts, outbox)",
    viewer: "marketing_viewer",
    admin: "marketing_admin",
  },
  { label: "Finance", viewer: "finance_viewer", admin: "finance_admin" },
  { label: "Fantasy", viewer: null, admin: "fantasy_admin" },
  {
    label: "Matchday (club-wide)",
    viewer: "matchday_viewer",
    admin: "matchday_admin",
  },
  {
    label: "Juniors (club-wide)",
    viewer: "juniors_viewer",
    admin: "juniors_admin",
  },
  { label: "AI facts", viewer: "ai_facts_viewer", admin: "ai_facts_admin" },
  {
    label: "AI knowledge",
    viewer: "ai_knowledge_viewer",
    admin: "ai_knowledge_admin",
  },
] as const satisfies ReadonlyArray<{
  label: string;
  viewer: RoleName | null;
  admin: RoleName | null;
}>;

const AI_USE_ROWS = [
  { label: "AI chat", role: "ai_chat_user" },
  { label: "AI scout", role: "ai_scout_user" },
] as const satisfies ReadonlyArray<{ label: string; role: RoleName }>;

function EditRolesDialog({
  user,
  onClose,
}: {
  user: Item;
  onClose: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["admin", "userDetail", user.id],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/users/{userId}", {
          params: { path: { userId: user.id } },
        }),
      ),
  });
  const juniorTeamsQuery = useQuery({
    queryKey: ["admin", "juniorTeams"],
    queryFn: () => callApi(api.GET("/api/admin/junior-teams")),
  });
  const pcTeamsQuery = useQuery({
    queryKey: ["admin", "playCricketTeams"],
    queryFn: () => callApi(api.GET("/api/admin/play-cricket-teams")),
  });

  const loading =
    detailQuery.isLoading ||
    juniorTeamsQuery.isLoading ||
    pcTeamsQuery.isLoading;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-stone-500">{user.email}</p>

        {loading || !detailQuery.data ? (
          <p className="py-8 text-center text-sm text-stone-500">Loading…</p>
        ) : (
          <EditRolesBody
            user={user}
            initialJuniorTeamIds={detailQuery.data.juniorManagerTeams.map(
              (t) => t.id,
            )}
            initialOfficialTeamIds={detailQuery.data.officialTeams.map(
              (t) => t.id,
            )}
            juniorTeams={juniorTeamsQuery.data ?? []}
            pcTeams={pcTeamsQuery.data ?? []}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditRolesBody({
  user,
  initialJuniorTeamIds,
  initialOfficialTeamIds,
  juniorTeams,
  pcTeams,
  onClose,
}: {
  user: Item;
  initialJuniorTeamIds: string[];
  initialOfficialTeamIds: string[];
  juniorTeams: ReadonlyArray<{ id: string; name: string }>;
  pcTeams: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<Set<RoleName>>(
    () => new Set(parseRoles(user.role)),
  );
  const [juniorTeamIds, setJuniorTeamIds] = useState<Set<string>>(
    () => new Set(initialJuniorTeamIds),
  );
  const [officialTeamIds, setOfficialTeamIds] = useState<Set<string>>(
    () => new Set(initialOfficialTeamIds),
  );

  const toggleRole = (role: RoleName) =>
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const toggleJuniorTeam = (id: string) =>
    setJuniorTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleOfficialTeam = (id: string) =>
    setOfficialTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const mutation = useMutation({
    mutationFn: async () => {
      // junior_manager and official are derived from team selections: if
      // any team is selected the user gets the role, otherwise they don't.
      const finalRoles = new Set(selectedRoles);
      finalRoles.delete("junior_manager");
      finalRoles.delete("official");
      if (juniorTeamIds.size > 0) finalRoles.add("junior_manager");
      if (officialTeamIds.size > 0) finalRoles.add("official");

      // Single transactional endpoint: user.role + both join tables move
      // together. The whole operation rolls back on any DB error so the
      // user can't end up with team scoping but no matching role (or vice
      // versa).
      const roleString =
        finalRoles.size > 0 ? Array.from(finalRoles).join(",") : "user";
      await callApi(
        api.PUT("/api/admin/access/users/{userId}/assignments", {
          params: { path: { userId: user.id } },
          body: {
            role: roleString,
            juniorTeamIds: Array.from(juniorTeamIds),
            officialTeamIds: Array.from(officialTeamIds),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "access", "list"],
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", user.id],
      });
      onClose();
    },
  });

  return (
    <>
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        <ViewManageGrid selected={selectedRoles} onToggle={toggleRole} />
        <AiUseGrid selected={selectedRoles} onToggle={toggleRole} />
        <PerTeamGrid
          title="Junior Manager (per junior team)"
          caption="Anyone with at least one junior team becomes a Junior Manager, scoped to those teams."
          teams={juniorTeams}
          selected={juniorTeamIds}
          onToggle={toggleJuniorTeam}
        />
        <PerTeamGrid
          title="Official (per play-cricket team)"
          caption="Anyone with at least one team becomes an Official, scoped to those teams."
          teams={pcTeams}
          selected={officialTeamIds}
          onToggle={toggleOfficialTeam}
        />
        <UserManagementSection selected={selectedRoles} onToggle={toggleRole} />
        <LegacyAdminSection selected={selectedRoles} onToggle={toggleRole} />
      </div>

      {mutation.error && (
        <p className="text-sm text-red-600">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Failed to save"}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </>
  );
}

function RoleCheckbox({
  role,
  selected,
  onToggle,
}: {
  role: RoleName | null;
  selected: Set<RoleName>;
  onToggle: (role: RoleName) => void;
}) {
  if (!role) return <span className="text-stone-300">{"—"}</span>;
  return (
    <Checkbox
      checked={selected.has(role)}
      onCheckedChange={() => onToggle(role)}
    />
  );
}

function ViewManageGrid({
  selected,
  onToggle,
}: {
  selected: Set<RoleName>;
  onToggle: (role: RoleName) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-stone-900">
        Feature access
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Feature</TableHead>
            <TableHead className="w-24 text-center">View</TableHead>
            <TableHead className="w-24 text-center">Manage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {VIEW_MANAGE_ROWS.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-center">
                <RoleCheckbox
                  role={row.viewer}
                  selected={selected}
                  onToggle={onToggle}
                />
              </TableCell>
              <TableCell className="text-center">
                <RoleCheckbox
                  role={row.admin}
                  selected={selected}
                  onToggle={onToggle}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function AiUseGrid({
  selected,
  onToggle,
}: {
  selected: Set<RoleName>;
  onToggle: (role: RoleName) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-stone-900">AI tools</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead className="w-24 text-center">Use</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {AI_USE_ROWS.map((row) => (
            <TableRow key={row.role}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-center">
                <Checkbox
                  checked={selected.has(row.role)}
                  onCheckedChange={() => onToggle(row.role)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function PerTeamGrid({
  title,
  caption,
  teams,
  selected,
  onToggle,
}: {
  title: string;
  caption: string;
  teams: ReadonlyArray<{ id: string; name: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-stone-900">{title}</h3>
      <p className="mb-2 text-xs text-stone-500">{caption}</p>
      {teams.length === 0 ? (
        <p className="text-sm text-stone-400">No teams available.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {teams.map((team) => (
                  <TableHead
                    key={team.id}
                    className="min-w-20 text-center text-xs"
                  >
                    {team.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                {teams.map((team) => (
                  <TableCell key={team.id} className="text-center">
                    <Checkbox
                      checked={selected.has(team.id)}
                      onCheckedChange={() => onToggle(team.id)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function UserManagementSection({
  selected,
  onToggle,
}: {
  selected: Set<RoleName>;
  onToggle: (role: RoleName) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-stone-900">
        User management
      </h3>
      <div className="space-y-1 text-sm">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-stone-50">
          <Checkbox
            checked={selected.has("user_manager")}
            onCheckedChange={() => onToggle("user_manager")}
          />
          <span>
            <strong>User manager:</strong> archive, restore, link members, edit
            categories
          </span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-stone-50">
          <Checkbox
            checked={selected.has("superadmin")}
            onCheckedChange={() => onToggle("superadmin")}
          />
          <span>
            <strong>Superadmin:</strong> can assign roles to other users (this
            tab)
          </span>
        </label>
      </div>
    </section>
  );
}

function LegacyAdminSection({
  selected,
  onToggle,
}: {
  selected: Set<RoleName>;
  onToggle: (role: RoleName) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-stone-900">Legacy</h3>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-stone-50">
        <Checkbox
          checked={selected.has("admin")}
          onCheckedChange={() => onToggle("admin")}
        />
        <span>
          <strong>Admin:</strong> kitchen-sink role granting every permission.
          Prefer assigning specific roles above instead.
        </span>
      </label>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Add User dialog
// ────────────────────────────────────────────────────────────────────────

function AddUserDialog({
  onClose,
  onPicked,
}: {
  onClose: () => void;
  onPicked: (user: {
    id: string;
    name: string;
    email: string;
    role: string | null;
  }) => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(search), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const query = useQuery({
    queryKey: ["admin", "access", "search", debounced],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/access/search", {
          params: { query: { search: debounced } },
        }),
      ),
    enabled: debounced.length > 0,
  });

  const results = query.data?.items ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add user to Access list</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-stone-500">
          Search for a user by name or email, then assign roles.
        </p>
        <Input
          autoFocus
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {debounced.length === 0 && (
            <p className="py-2 text-center text-sm text-stone-500">
              Type to search.
            </p>
          )}
          {query.isLoading && debounced.length > 0 && (
            <p className="py-2 text-center text-sm text-stone-500">
              Searching…
            </p>
          )}
          {results.length === 0 && !query.isLoading && debounced.length > 0 && (
            <p className="py-2 text-center text-sm text-stone-500">
              No matches.
            </p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onClose();
                onPicked(u);
              }}
              className="flex items-center justify-between rounded px-3 py-2 text-left hover:bg-stone-50"
            >
              <span>
                <span className="font-medium">{u.name}</span>
                <span className="ml-2 text-xs text-stone-500">{u.email}</span>
              </span>
              <RoleChipList role={u.role ?? ""} />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
