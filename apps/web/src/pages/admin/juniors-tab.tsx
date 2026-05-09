import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { paths } from "@/lib/api.gen";
import { AGE_GROUPS } from "@percy-main/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  initialJuniorsFilterState,
  juniorsFilterReducer,
} from "./juniors-tab.reducer";
import { formatDate } from "./status-pill";

type JuniorsResponse =
  paths["/api/admin/juniors"]["get"]["responses"]["200"]["content"]["application/json"];
type Junior = JuniorsResponse["juniors"][number];

function isMembershipActive(paidUntil: string | null): boolean {
  if (!paidUntil) return false;
  return new Date(paidUntil) >= new Date();
}

/** Ordered list of all possible team keys for consistent display order. */
const TEAM_ORDER = AGE_GROUPS.flatMap((group) => [
  `${group} Boys`,
  `${group} Girls`,
]);

const PAGE_SIZE = 100;

export function JuniorsTab() {
  const queryClient = useQueryClient();
  const [filters, dispatch] = useReducer(
    juniorsFilterReducer,
    initialJuniorsFilterState,
  );
  const {
    page,
    search,
    debouncedSearch,
    ageGroupFilter,
    sexFilter,
    membershipFilter,
  } = filters;
  const [selectedJunior, setSelectedJunior] = useState<Junior | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      dispatch({ type: "commitSearch", value: search });
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "admin",
      "listJuniors",
      page,
      PAGE_SIZE,
      debouncedSearch,
      sexFilter,
      ageGroupFilter,
      membershipFilter,
    ],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/juniors", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
              ...(sexFilter !== "all" ? { sex: sexFilter } : {}),
              ...(ageGroupFilter !== "all" ? { ageGroup: ageGroupFilter } : {}),
              ...(membershipFilter !== "all"
                ? { membershipStatus: membershipFilter }
                : {}),
            },
          },
        }),
      ),
  });

  const juniors = useMemo<Junior[]>(() => data?.juniors ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const grouped = useMemo(() => {
    const groups = new Map<string, Junior[]>();

    for (const junior of juniors) {
      const key = junior.teamName ?? "Overage";
      const existing = groups.get(key);
      if (existing) {
        existing.push(junior);
      } else {
        groups.set(key, [junior]);
      }
    }

    // Sort teams according to the defined order
    const sorted = new Map<string, Junior[]>();
    for (const teamKey of TEAM_ORDER) {
      const members = groups.get(teamKey);
      if (members && members.length > 0) {
        sorted.set(teamKey, members);
      }
    }
    // Append overage players at the end
    const overage = groups.get("Overage");
    if (overage && overage.length > 0) {
      sorted.set("Overage", overage);
    }

    return sorted;
  }, [juniors]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="text"
          placeholder="Search by junior or parent name…"
          value={search}
          onChange={(e) =>
            dispatch({ type: "setSearch", value: e.target.value })
          }
          className="max-w-xs"
        />
        <Select
          value={ageGroupFilter}
          onValueChange={(value) =>
            dispatch({
              type: "setAgeGroupFilter",
              value: value as typeof ageGroupFilter,
            })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Age Groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Age Groups</SelectItem>
            {AGE_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sexFilter}
          onValueChange={(value) =>
            dispatch({
              type: "setSexFilter",
              value: value as typeof sexFilter,
            })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Genders" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Genders</SelectItem>
            <SelectItem value="male">Boys</SelectItem>
            <SelectItem value="female">Girls</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={membershipFilter}
          onValueChange={(value) =>
            dispatch({
              type: "setMembershipFilter",
              value: value as typeof membershipFilter,
            })
          }
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Memberships" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Memberships</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <p className="text-sm text-stone-500">
        Showing {juniors.length} of {total} junior
        {total !== 1 ? "s" : ""}
      </p>

      {/* Loading / Error */}
      {isLoading && <p className="text-stone-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load juniors.</p>}

      {/* Grouped teams */}
      {!isLoading && !error && (
        <div className="flex flex-col gap-4">
          {grouped.size === 0 && (
            <p className="py-6 text-center text-stone-500">
              No juniors found matching the current filters.
            </p>
          )}
          {Array.from(grouped.entries()).map(([teamName, members]) => (
            <TeamCard
              key={teamName}
              teamName={teamName}
              members={members}
              onJuniorClick={setSelectedJunior}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              dispatch({ type: "setPage", value: Math.max(1, page - 1) })
            }
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-stone-600">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              dispatch({
                type: "setPage",
                value: Math.min(totalPages, page + 1),
              })
            }
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* Linking dialog */}
      {selectedJunior && (
        <LinkingDialog
          junior={selectedJunior}
          onClose={() => setSelectedJunior(null)}
          onLinked={() => {
            void queryClient.invalidateQueries({
              queryKey: ["admin", "listJuniors"],
            });
          }}
        />
      )}
    </div>
  );
}

function TeamCard({
  teamName,
  members,
  onJuniorClick,
}: {
  teamName: string;
  members: Junior[];
  onJuniorClick: (junior: Junior) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {teamName}
            <Badge variant="secondary">{members.length}</Badge>
          </CardTitle>
          <span className="text-sm text-stone-400">
            {expanded ? "Collapse" : "Expand"}
          </span>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>DOB</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Membership</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((junior) => {
                const paid = isMembershipActive(junior.paidUntil);
                return (
                  <TableRow
                    key={junior.id}
                    className="cursor-pointer"
                    onClick={() => onJuniorClick(junior)}
                  >
                    <TableCell className="font-medium">{junior.name}</TableCell>
                    <TableCell>{formatDate(junior.dob)}</TableCell>
                    <TableCell>{junior.parentName}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <a
                          href={`mailto:${junior.parentEmail}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {junior.parentEmail}
                        </a>
                        <span>{junior.parentTelephone}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {junior.hasOwnAccount ? (
                        <Badge
                          variant="outline"
                          className="border-blue-300 text-blue-700"
                        >
                          Linked
                        </Badge>
                      ) : (
                        <span className="text-xs text-stone-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={paid ? "success" : "destructive"}>
                        {paid ? "Paid" : "Unpaid"}
                      </Badge>
                      {junior.paidUntil && (
                        <span className="ml-1 text-xs text-stone-500">
                          until {formatDate(junior.paidUntil)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}

function LinkingDialog({
  junior,
  onClose,
  onLinked,
}: {
  junior: Junior;
  onClose: () => void;
  onLinked: () => void;
}) {
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(userSearch);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [userSearch]);

  const suggestedUsersQuery = useQuery({
    queryKey: ["admin", "searchUsersForLinking", junior.id, debouncedSearch],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/juniors/search-users", {
          params: {
            query: {
              dependentId: junior.id,
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
            },
          },
        }),
      ),
  });

  const linkMutation = useMutation({
    mutationFn: (userId: string) =>
      callApi(
        api.POST("/api/admin/juniors/link", {
          body: { dependentId: junior.id, userId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "listJuniors"],
      });
      onLinked();
      onClose();
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/juniors/unlink", {
          body: { dependentId: junior.id },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "listJuniors"],
      });
      onLinked();
      onClose();
    },
  });

  const users = suggestedUsersQuery.data?.users ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Account - {junior.name}</DialogTitle>
        </DialogHeader>

        {/* Current status */}
        <div className="rounded border border-stone-200 p-3">
          <p className="text-sm text-stone-600">
            <span className="font-medium">Parent:</span> {junior.parentName} (
            {junior.parentEmail})
          </p>
          {junior.hasOwnAccount ? (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm">
                <span className="font-medium">Linked to:</span>{" "}
                <span className="text-blue-700">{junior.linkedUserEmail}</span>
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                Unlink
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-stone-400">No linked account</p>
          )}
        </div>

        {/* Search & suggested users */}
        <div className="mt-2">
          <Input
            type="text"
            placeholder="Search by name or email…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="mb-2"
          />

          {suggestedUsersQuery.isLoading && (
            <p className="text-sm text-stone-500">
              Searching for matching users...
            </p>
          )}
          {suggestedUsersQuery.error && (
            <p className="text-sm text-red-600">Failed to search users.</p>
          )}

          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {users.length === 0 && !suggestedUsersQuery.isLoading && (
              <p className="py-2 text-center text-sm text-stone-500">
                No matching users found.
              </p>
            )}
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between rounded px-3 py-2 hover:bg-stone-50"
              >
                <div>
                  <span className="font-medium">{user.name}</span>
                  <span className="ml-2 text-xs text-stone-500">
                    {user.email}
                  </span>
                  {user.score >= 0.7 && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-green-300 text-green-700"
                    >
                      Strong match
                    </Badge>
                  )}
                  {user.score >= 0.4 && user.score < 0.7 && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-yellow-300 text-yellow-700"
                    >
                      Possible match
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => linkMutation.mutate(user.id)}
                  disabled={linkMutation.isPending}
                >
                  Link
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
