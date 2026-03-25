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
import type { paths } from "@/lib/api.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  StatusPill,
  formatDate,
  formatPence,
  getMemberCategoryDisplay,
  getMembershipStatus,
  getMembershipTypeDisplay,
} from "./status-pill";

type UserDetail =
  paths["/api/admin/users/{userId}"]["get"]["responses"]["200"]["content"]["application/json"];

interface MemberDetailModalProps {
  userId: string;
  onClose: () => void;
}

const CATEGORY_OPTIONS = [
  { value: "__none__", label: "Not set" },
  { value: "senior", label: "Senior" },
  { value: "junior", label: "Junior" },
  { value: "student", label: "Student" },
  { value: "bursary", label: "Bursary" },
  { value: "guest", label: "Guest" },
] as const;

export function MemberDetailModal({ userId, onClose }: MemberDetailModalProps) {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "userDetail", userId],
    });
    void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "userDetail", userId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/users/{userId}", {
          params: { path: { userId } },
        }),
      ),
  });

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        {isLoading || !data ? (
          <div className="py-12 text-center text-gray-500">Loading...</div>
        ) : (
          <MemberDetailContent
            data={data}
            userId={userId}
            invalidateAll={invalidateAll}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberDetailContent({
  data,
  userId,
  invalidateAll,
}: {
  data: UserDetail;
  userId: string;
  invalidateAll: () => void;
}) {
  const { user, member, membership, dependents, charges } = data;

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>{user.name}</DialogTitle>
      </DialogHeader>

      {/* 1. Archived Banner */}
      {member?.deleted_at && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            This member was archived: {member.deleted_reason}
          </p>
          <p className="mt-1 text-sm text-red-700">
            Archived on {formatDate(member.deleted_at, true)}
          </p>
        </div>
      )}

      {/* 2. Account Section */}
      <AccountSection
        user={user}
        userId={userId}
        invalidateAll={invalidateAll}
      />

      <hr />

      {/* 3. Member Details */}
      <MemberDetailsSection member={member} />

      <hr />

      {/* 4. Member Category */}
      <MemberCategorySection
        member={member}
        userId={userId}
        invalidateAll={invalidateAll}
      />

      <hr />

      {/* 5. Membership */}
      <MembershipSection membership={membership} />

      <hr />

      {/* 6. Junior Members */}
      <JuniorMembersSection dependents={dependents} />

      <hr />

      {/* 7. Junior Manager Teams */}
      <JuniorManagerTeamsSection
        key={`jm-${data.juniorManagerTeams.map((t) => t.id).join(",")}`}
        userId={userId}
        userRole={user.role ?? "user"}
        selectedTeamIds={data.juniorManagerTeams.map((t) => t.id)}
        invalidateAll={invalidateAll}
      />

      <hr />

      {/* 8. Match Official Teams */}
      <OfficialTeamsSection
        key={`off-${data.officialTeams.map((t) => t.id).join(",")}`}
        userId={userId}
        userRole={user.role ?? "user"}
        selectedTeamIds={data.officialTeams.map((t) => t.id)}
        invalidateAll={invalidateAll}
      />

      <hr />

      {/* 9. Payments */}
      <PaymentsSection
        userId={userId}
        charges={charges}
        invalidateAll={invalidateAll}
      />

      <hr />

      {/* 10. Archive/Restore */}
      <ArchiveSection
        userId={userId}
        member={member}
        invalidateAll={invalidateAll}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Account Section                                                  */
/* ------------------------------------------------------------------ */

function AccountSection({
  user,
  userId,
  invalidateAll,
}: {
  user: UserDetail["user"];
  userId: string;
  invalidateAll: () => void;
}) {
  const [confirmingRole, setConfirmingRole] = useState(false);

  const roleMutation = useMutation({
    mutationFn: (newRole: string) =>
      callApi(
        api.PUT("/api/admin/users/{userId}", {
          params: { path: { userId } },
          body: {
            userId,
            role: newRole as
              | "user"
              | "admin"
              | "junior_manager"
              | "official"
              | null,
          },
        }),
      ),
    onSuccess: () => {
      invalidateAll();
      setConfirmingRole(false);
    },
  });

  const isAdmin = user.role === "admin";
  const targetRole = isAdmin ? "user" : "admin";

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Account</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-gray-500">Name</span>
          <p>{user.name}</p>
        </div>
        <div>
          <span className="text-gray-500">Email</span>
          <p>{user.email}</p>
        </div>
        <div>
          <span className="text-gray-500">Role</span>
          <p>
            <RolePill role={user.role ?? "user"} />
          </p>
        </div>
        <div>
          <span className="text-gray-500">Email Verified</span>
          <p>{user.emailVerified ? "Yes" : "No"}</p>
        </div>
        <div>
          <span className="text-gray-500">Created</span>
          <p>{formatDate(user.createdAt, true)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {!confirmingRole ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingRole(true)}
          >
            {isAdmin ? "Demote to User" : "Promote to Admin"}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={roleMutation.isPending}
              onClick={() => roleMutation.mutate(targetRole)}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingRole(false)}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function RolePill({ role }: { role: string }) {
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

/* ------------------------------------------------------------------ */
/* 3. Member Details Section                                           */
/* ------------------------------------------------------------------ */

function MemberDetailsSection({ member }: { member: UserDetail["member"] }) {
  if (!member) {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Member Details
        </h3>
        <p className="text-sm text-gray-500">
          No member record found for this user.
        </p>
      </section>
    );
  }

  const fields: Array<{ label: string; value: string | null }> = [
    { label: "Title", value: member.title },
    {
      label: "Name",
      value: member.name,
    },
    { label: "Address", value: member.address },
    { label: "Postcode", value: member.postcode },
    {
      label: "Date of Birth",
      value: member.dob ? formatDate(member.dob) : null,
    },
    { label: "Telephone", value: member.telephone },
    { label: "Emergency Contact", value: member.emergency_contact_name },
    {
      label: "Emergency Telephone",
      value: member.emergency_contact_telephone,
    },
  ];

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Member Details
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => (
          <div key={f.label}>
            <span className="text-gray-500">{f.label}</span>
            <p>{f.value ?? "-"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Member Category Section                                          */
/* ------------------------------------------------------------------ */

function MemberCategorySection({
  member,
  userId,
  invalidateAll,
}: {
  member: UserDetail["member"];
  userId: string;
  invalidateAll: () => void;
}) {
  const currentCategory = member?.member_category ?? null;
  const categoryDisplay = getMemberCategoryDisplay(currentCategory);

  const mutation = useMutation({
    mutationFn: (memberCategory: string | null) =>
      callApi(
        api.PUT("/api/admin/users/{userId}/category", {
          params: { path: { userId } },
          body: { userId, memberCategory },
        }),
      ),
    onSuccess: invalidateAll,
  });

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Member Category
      </h3>
      <div className="flex items-center gap-3">
        <StatusPill variant={categoryDisplay.variant}>
          {categoryDisplay.label}
        </StatusPill>
        <Select
          value={currentCategory ?? "__none__"}
          onValueChange={(v) => mutation.mutate(v === "__none__" ? null : v)}
          disabled={mutation.isPending}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Membership Section                                               */
/* ------------------------------------------------------------------ */

function MembershipSection({
  membership,
}: {
  membership: UserDetail["membership"];
}) {
  if (!membership) {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Membership</h3>
        <p className="text-sm text-gray-500">No membership record found.</p>
      </section>
    );
  }

  const typeDisplay = getMembershipTypeDisplay(membership.type);
  const status = getMembershipStatus(membership.paid_until);

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Membership</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-gray-500">Type</span>
          <p>
            <StatusPill variant={typeDisplay.variant}>
              {typeDisplay.label}
            </StatusPill>
          </p>
        </div>
        <div>
          <span className="text-gray-500">Paid Until</span>
          <p>
            {membership.paid_until ? formatDate(membership.paid_until) : "-"}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Status</span>
          <p>
            <StatusPill variant={status.variant}>{status.label}</StatusPill>
          </p>
        </div>
        <div>
          <span className="text-gray-500">Created</span>
          <p>{formatDate(membership.created_at)}</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Junior Members Section                                           */
/* ------------------------------------------------------------------ */

function JuniorMembersSection({
  dependents,
}: {
  dependents: UserDetail["dependents"];
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Junior Members ({dependents.length})
      </h3>
      {dependents.length === 0 ? (
        <p className="text-sm text-gray-500">No junior members.</p>
      ) : (
        <div className="space-y-3">
          {dependents.map((dep) => (
            <DependentCard key={dep.id} dependent={dep} />
          ))}
        </div>
      )}
    </section>
  );
}

function DependentCard({
  dependent,
}: {
  dependent: UserDetail["dependents"][number];
}) {
  const name = dependent.name;
  const paidUntil = dependent.membershipPaidUntil;
  const hasPaid = paidUntil !== null;

  const formatSex = (sex: string | null) => {
    if (!sex) return null;
    if (sex === "prefer_not_to_say") return "Prefer not to say";
    return sex.charAt(0).toUpperCase() + sex.slice(1);
  };

  const fields: Array<{ label: string; value: string | null }> = [
    {
      label: "Date of Birth",
      value: dependent.dob ? formatDate(dependent.dob) : null,
    },
    { label: "Sex", value: formatSex(dependent.sex) },
    { label: "School Year", value: dependent.school_year },
    {
      label: "Photo Consent",
      value:
        dependent.photo_consent !== null
          ? dependent.photo_consent
            ? "Yes"
            : "No"
          : null,
    },
    {
      label: "GP Surgery / Phone",
      value:
        [dependent.gp_surgery, dependent.gp_phone]
          .filter(Boolean)
          .join(" / ") || null,
    },
    {
      label: "Alt Contact",
      value:
        [dependent.alt_contact_name, dependent.alt_contact_phone]
          .filter(Boolean)
          .join(" / ") || null,
    },
    {
      label: "Emergency Medical Consent",
      value:
        dependent.emergency_medical_consent !== null
          ? dependent.emergency_medical_consent
            ? "Yes"
            : "No"
          : null,
    },
    {
      label: "Disability",
      value: dependent.has_disability
        ? (dependent.disability_type ?? "Yes")
        : null,
    },
  ];

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold">{name}</span>
        {hasPaid && paidUntil ? (
          <StatusPill variant="green">
            Paid until {formatDate(paidUntil)}
          </StatusPill>
        ) : (
          <StatusPill variant="yellow">Unpaid</StatusPill>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {fields
          .filter((f) => f.value !== null)
          .map((f) => (
            <div key={f.label}>
              <span className="text-gray-500">{f.label}</span>
              <p>{f.value}</p>
            </div>
          ))}
      </div>
      {dependent.medical_info && (
        <div className="mt-2 text-sm">
          <span className="text-gray-500">Medical Info</span>
          <p className="whitespace-pre-wrap">{dependent.medical_info}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Junior Manager Teams Section                                     */
/* ------------------------------------------------------------------ */

function JuniorManagerTeamsSection({
  userId,
  userRole,
  selectedTeamIds,
  invalidateAll,
}: {
  userId: string;
  userRole: string;
  selectedTeamIds: string[];
  invalidateAll: () => void;
}) {
  const [localIds, setLocalIds] = useState<string[]>(selectedTeamIds);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["admin", "juniorTeams"],
    queryFn: () => callApi(api.GET("/api/admin/junior-teams")),
  });

  const mutation = useMutation({
    mutationFn: (teamIds: string[]) =>
      callApi(
        api.PUT("/api/admin/users/{userId}/junior-manager-teams", {
          params: { path: { userId } },
          body: { userId, teamIds },
        }),
      ),
    onSuccess: () => {
      invalidateAll();
      setHasChanges(false);
    },
  });

  const toggleTeam = (teamId: string) => {
    setLocalIds((prev) =>
      prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId],
    );
    setHasChanges(true);
  };

  const removeAll = () => {
    setLocalIds([]);
    setHasChanges(true);
  };

  if (userRole === "admin") {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Junior Manager Teams
        </h3>
        <p className="text-sm text-gray-500">
          Admins have access to all teams. Team assignment is only for the
          Junior Manager role.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Junior Manager Teams
      </h3>
      {teams && teams.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {teams.map((team) => {
              const selected = localIds.includes(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {team.name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={!hasChanges || mutation.isPending}
              onClick={() => mutation.mutate(localIds)}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={localIds.length === 0}
              onClick={removeAll}
            >
              Remove All Teams
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500">No junior teams available.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 8. Match Official Teams Section                                     */
/* ------------------------------------------------------------------ */

function OfficialTeamsSection({
  userId,
  userRole,
  selectedTeamIds,
  invalidateAll,
}: {
  userId: string;
  userRole: string;
  selectedTeamIds: string[];
  invalidateAll: () => void;
}) {
  const [localIds, setLocalIds] = useState<string[]>(selectedTeamIds);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["admin", "playCricketTeams"],
    queryFn: () => callApi(api.GET("/api/admin/play-cricket-teams")),
  });

  const mutation = useMutation({
    mutationFn: (teamIds: string[]) =>
      callApi(
        api.PUT("/api/admin/users/{userId}/official-teams", {
          params: { path: { userId } },
          body: { userId, teamIds },
        }),
      ),
    onSuccess: () => {
      invalidateAll();
      setHasChanges(false);
    },
  });

  const toggleTeam = (teamId: string) => {
    setLocalIds((prev) =>
      prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId],
    );
    setHasChanges(true);
  };

  const removeAll = () => {
    setLocalIds([]);
    setHasChanges(true);
  };

  if (userRole === "admin") {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Match Official Teams
        </h3>
        <p className="text-sm text-gray-500">
          Admins have access to all teams. Team assignment is only for the
          Official role.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Match Official Teams
      </h3>
      {teams && teams.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {teams.map((team) => {
              const selected = localIds.includes(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {team.name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={!hasChanges || mutation.isPending}
              onClick={() => mutation.mutate(localIds)}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={localIds.length === 0}
              onClick={removeAll}
            >
              Remove All Teams
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500">No teams available.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 9. Payments Section                                                 */
/* ------------------------------------------------------------------ */

function PaymentsSection({
  userId,
  charges,
  invalidateAll,
}: {
  userId: string;
  charges: UserDetail["charges"];
  invalidateAll: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [chargeDate, setChargeDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );

  const createCharge = useMutation({
    mutationFn: (body: {
      description: string;
      amountPence: number;
      chargeDate: string;
    }) =>
      callApi(
        api.POST("/api/admin/users/{userId}/charges", {
          params: { path: { userId } },
          body,
        }),
      ),
    onSuccess: () => {
      invalidateAll();
      setDescription("");
      setAmount("");
      setChargeDate(new Date().toISOString().split("T")[0]);
      setShowForm(false);
    },
  });

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount);
    if (!description || isNaN(amountNum) || amountNum < 0.01) return;
    createCharge.mutate({
      description,
      amountPence: Math.round(amountNum * 100),
      chargeDate,
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Payments</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "Add Payment"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 space-y-3 rounded-md border border-gray-200 p-3"
        >
          <div>
            <label className="mb-1 block text-sm text-gray-600">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-600">
                Amount (GBP)
              </label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Date</label>
              <Input
                type="date"
                value={chargeDate}
                onChange={(e) => setChargeDate(e.target.value)}
                required
              />
            </div>
          </div>
          <Button size="sm" type="submit" disabled={createCharge.isPending}>
            Create Charge
          </Button>
        </form>
      )}

      {charges.length === 0 ? (
        <p className="text-sm text-gray-500">No charges recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.map((charge) => (
              <ChargeRow
                key={charge.id}
                charge={charge}
                invalidateAll={invalidateAll}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ChargeRow({
  charge,
  invalidateAll,
}: {
  charge: UserDetail["charges"][number];
  invalidateAll: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");

  const deleteMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.DELETE("/api/admin/charges/{chargeId}", {
          params: { path: { chargeId: charge.id } },
          body: { chargeId: charge.id, reason: deleteReason },
        }),
      ),
    onSuccess: () => {
      invalidateAll();
      setShowDelete(false);
    },
  });

  const canDelete = !charge.paid_at && !charge.payment_confirmed_at;

  const getChargeStatus = () => {
    if (charge.paid_at) return { label: "Paid", variant: "green" as const };
    if (charge.payment_confirmed_at)
      return { label: "Pending", variant: "blue" as const };
    return { label: "Unpaid", variant: "yellow" as const };
  };

  const status = getChargeStatus();

  return (
    <TableRow>
      <TableCell>{formatDate(charge.charge_date)}</TableCell>
      <TableCell>{charge.description}</TableCell>
      <TableCell>{formatPence(charge.amount_pence)}</TableCell>
      <TableCell>
        <StatusPill variant={charge.source === "admin" ? "gray" : "blue"}>
          {charge.source}
        </StatusPill>
      </TableCell>
      <TableCell>
        <StatusPill variant={status.variant}>{status.label}</StatusPill>
      </TableCell>
      <TableCell>
        {canDelete && !showDelete && (
          <Button variant="ghost" size="sm" onClick={() => setShowDelete(true)}>
            Delete
          </Button>
        )}
        {showDelete && (
          <div className="flex items-center gap-1">
            <Input
              placeholder="Reason..."
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="h-8 w-32 text-xs"
            />
            <Button
              variant="destructive"
              size="sm"
              disabled={!deleteReason || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowDelete(false);
                setDeleteReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ */
/* 10. Archive / Restore Section                                       */
/* ------------------------------------------------------------------ */

function ArchiveSection({
  userId,
  member,
  invalidateAll,
}: {
  userId: string;
  member: UserDetail["member"];
  invalidateAll: () => void;
}) {
  const isArchived =
    member?.deleted_at !== null && member?.deleted_at !== undefined;
  const [showArchiveForm, setShowArchiveForm] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  const archiveMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/users/{userId}/archive", {
          params: { path: { userId } },
          body: { userId, reason: archiveReason },
        }),
      ),
    onSuccess: () => {
      invalidateAll();
      setShowArchiveForm(false);
      setArchiveReason("");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/users/{userId}/restore", {
          params: { path: { userId } },
        }),
      ),
    onSuccess: invalidateAll,
  });

  if (isArchived) {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Archive Status
        </h3>
        <p className="mb-3 text-sm text-gray-500">
          This member is currently archived. Restoring will make them active
          again.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={restoreMutation.isPending}
          onClick={() => restoreMutation.mutate()}
        >
          Restore Member
        </Button>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Archive Status
      </h3>
      <p className="mb-3 text-sm text-gray-500">
        Archiving a member will hide them from the default member list.
      </p>
      {!showArchiveForm ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowArchiveForm(true)}
        >
          Archive Member
        </Button>
      ) : (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder="Reason for archiving..."
            rows={3}
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={!archiveReason || archiveMutation.isPending}
              onClick={() => archiveMutation.mutate()}
            >
              Confirm Archive
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowArchiveForm(false);
                setArchiveReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
