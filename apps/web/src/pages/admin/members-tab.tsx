import { Button } from "@/components/ui/button";
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
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MemberDetailModal } from "./member-detail-modal";
import {
  StatusPill,
  getMemberCategoryDisplay,
  getMembershipStatus,
  getMembershipTypeDisplay,
} from "./status-pill";

const PAGE_SIZE = 20;

export function MembersTab() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [isMember, setIsMember] = useState("");
  const [membershipStatus, setMembershipStatus] = useState("");
  const [membershipType, setMembershipType] = useState("");
  const [memberCategory, setMemberCategory] = useState("");
  const [role, setRole] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "admin",
      "listUsers",
      page,
      debouncedSearch,
      includeArchived,
      isMember,
      membershipStatus,
      membershipType,
      memberCategory,
      role,
    ],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/users", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
              ...(includeArchived ? { includeArchived: true } : {}),
              ...(isMember ? { isMember: isMember === "true" } : {}),
              ...(membershipStatus
                ? {
                    membershipStatus: membershipStatus as
                      | "active"
                      | "lapsed"
                      | "none",
                  }
                : {}),
              ...(membershipType ? { membershipType } : {}),
              ...(memberCategory ? { memberCategory } : {}),
              ...(role ? { role } : {}),
            },
          },
        }),
      ),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const hasActiveFilters =
    debouncedSearch !== "" ||
    includeArchived ||
    isMember !== "" ||
    membershipStatus !== "" ||
    membershipType !== "" ||
    memberCategory !== "" ||
    role !== "";

  const clearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setIncludeArchived(false);
    setIsMember("");
    setMembershipStatus("");
    setMembershipType("");
    setMemberCategory("");
    setRole("");
    setPage(1);
  };

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by name or email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64"
        />

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => {
              setIncludeArchived(e.target.checked);
              resetPage();
            }}
          />
          Show archived
        </label>

        <Select
          value={isMember}
          onValueChange={(v) => {
            setIsMember(v === "__all__" ? "" : v);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Members" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Members</SelectItem>
            <SelectItem value="true">Member</SelectItem>
            <SelectItem value="false">Not Member</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={membershipStatus}
          onValueChange={(v) => {
            const newStatus = v === "__all__" ? "" : v;
            setMembershipStatus(newStatus);
            if (newStatus === "none") {
              setMembershipType("");
            }
            resetPage();
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="lapsed">Expired</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={membershipType}
          onValueChange={(v) => {
            setMembershipType(v === "__all__" ? "" : v);
            resetPage();
          }}
          disabled={membershipStatus === "none"}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            <SelectItem value="senior_player">Senior Player</SelectItem>
            <SelectItem value="senior_women_player">Women's Player</SelectItem>
            <SelectItem value="social">Social</SelectItem>
            <SelectItem value="junior">Junior</SelectItem>
            <SelectItem value="concessionary">
              Student / Concessionary
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={memberCategory}
          onValueChange={(v) => {
            setMemberCategory(v === "__all__" ? "" : v);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Categories</SelectItem>
            <SelectItem value="senior">Senior</SelectItem>
            <SelectItem value="junior">Junior</SelectItem>
            <SelectItem value="student">Student</SelectItem>
            <SelectItem value="bursary">Bursary</SelectItem>
            <SelectItem value="guest">Guest</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v === "__all__" ? "" : v);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Roles</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="official">Official</SelectItem>
            <SelectItem value="junior_manager">Junior Manager</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Membership Status</TableHead>
              <TableHead>Membership Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((user) => {
              const isArchived = user.memberDeletedAt !== null;
              const memberStatus = getMembershipStatus(
                user.membershipPaidUntil,
              );
              const typeDisplay = getMembershipTypeDisplay(user.membershipType);
              const categoryDisplay = getMemberCategoryDisplay(
                user.member_category,
              );

              return (
                <TableRow
                  key={user.id}
                  className={`cursor-pointer ${isArchived ? "opacity-50" : ""}`}
                  onClick={() => setSelectedUserId(user.id)}
                >
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {isArchived ? (
                      <StatusPill variant="red">Archived</StatusPill>
                    ) : user.memberId ? (
                      <StatusPill variant="green">Member</StatusPill>
                    ) : (
                      <StatusPill variant="red">Not Member</StatusPill>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={memberStatus.variant}>
                      {memberStatus.label}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={typeDisplay.variant}>
                      {typeDisplay.label}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={categoryDisplay.variant}>
                      {categoryDisplay.label}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <RolePills role={user.role ?? "user"} />
                  </TableCell>
                </TableRow>
              );
            })}
            {data?.items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-12 text-center text-gray-500"
                >
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            {data.total} users total
          </span>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedUserId !== null && (
        <MemberDetailModal
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}

function RolePills({ role }: { role: string }) {
  switch (role) {
    case "admin":
      return <StatusPill variant="blue">Admin</StatusPill>;
    case "junior_manager":
      return <StatusPill variant="green">Junior Manager</StatusPill>;
    case "official":
      return <StatusPill variant="green">Official</StatusPill>;
    default:
      return <StatusPill variant="gray">User</StatusPill>;
  }
}
