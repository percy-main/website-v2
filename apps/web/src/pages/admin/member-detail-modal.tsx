import { Badge } from "@/components/ui/badge";
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
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  buildDependentFields,
  buildMemberDetailFields,
  canDeleteCharge,
  getChargeStatus,
  getRoleLabels,
  isMemberArchived,
  parseNewChargeForm,
} from "./member-detail-modal.lib";
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
      <DialogContent className="max-w-2xl">
        {isLoading || !data ? (
          <div className="py-12 text-center text-stone-500">Loading…</div>
        ) : (
          <MemberDetailContent data={data} userId={userId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberDetailContent({
  data,
  userId,
}: {
  data: UserDetail;
  userId: string;
}) {
  const {
    user,
    member,
    membership,
    dependents,
    charges,
    linkedParents,
    linkedJuniors,
  } = data;

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
      <AccountSection user={user} />

      <hr />

      {/* 3. Member Details */}
      <MemberDetailsSection member={member} />

      <hr />

      {/* 4. Member Category */}
      <MemberCategorySection member={member} userId={userId} />

      <hr />

      {/* 5. Membership */}
      <MembershipSection membership={membership} />

      <hr />

      {/* 6a. Linked parents (admin-managed) */}
      {member && (
        <>
          <LinkedParentsSection
            userId={userId}
            memberId={member.id}
            linkedParents={linkedParents}
          />
          <hr />
        </>
      )}

      {/* 6b. Junior Members (self-registered dependents + linked juniors) */}
      <JuniorMembersSection
        dependents={dependents}
        linkedJuniors={linkedJuniors}
      />

      <hr />

      {/* 9. Payments */}
      <PaymentsSection userId={userId} charges={charges} />

      <hr />

      {/* 10. Archive/Restore */}
      <ArchiveSection userId={userId} member={member} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Account Section                                                  */
/* ------------------------------------------------------------------ */

function AccountSection({ user }: { user: UserDetail["user"] }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-stone-900">Account</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-stone-500">Name</span>
          <p>{user.name}</p>
        </div>
        <div>
          <span className="text-stone-500">Email</span>
          <p>{user.email}</p>
        </div>
        <div>
          <span className="text-stone-500">Roles</span>
          <p className="flex flex-wrap items-center gap-1">
            <RolePills role={user.role ?? null} />
          </p>
        </div>
        <div>
          <span className="text-stone-500">Email Verified</span>
          <p>{user.emailVerified ? "Yes" : "No"}</p>
        </div>
        <div>
          <span className="text-stone-500">Created</span>
          <p>{formatDate(user.createdAt, true)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Roles are now managed in the{" "}
        <Link to="/admin?section=access" className="underline">
          Access tab
        </Link>
        .
      </p>
    </section>
  );
}

function RolePills({ role }: { role: string | null }) {
  const labels = getRoleLabels(role);
  if (labels.length === 0) return <StatusPill variant="gray">User</StatusPill>;
  return (
    <>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Member Details Section                                           */
/* ------------------------------------------------------------------ */

function MemberDetailsSection({ member }: { member: UserDetail["member"] }) {
  if (!member) {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-stone-900">
          Member Details
        </h3>
        <p className="text-sm text-stone-500">
          No member record found for this user.
        </p>
      </section>
    );
  }

  const fields = buildMemberDetailFields(member);

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-stone-900">
        Member Details
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => (
          <div key={f.label}>
            <span className="text-stone-500">{f.label}</span>
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
}: {
  member: UserDetail["member"];
  userId: string;
}) {
  const queryClient = useQueryClient();
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
    },
  });

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-stone-900">
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
        <h3 className="mb-3 text-sm font-semibold text-stone-900">
          Membership
        </h3>
        <p className="text-sm text-stone-500">No membership record found.</p>
      </section>
    );
  }

  const typeDisplay = getMembershipTypeDisplay(membership.type);
  const status = getMembershipStatus(membership.paid_until);

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-stone-900">Membership</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-stone-500">Type</span>
          <p>
            <StatusPill variant={typeDisplay.variant}>
              {typeDisplay.label}
            </StatusPill>
          </p>
        </div>
        <div>
          <span className="text-stone-500">Paid Until</span>
          <p>
            {membership.paid_until ? formatDate(membership.paid_until) : "-"}
          </p>
        </div>
        <div>
          <span className="text-stone-500">Status</span>
          <p>
            <StatusPill variant={status.variant}>{status.label}</StatusPill>
          </p>
        </div>
        <div>
          <span className="text-stone-500">Created</span>
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
  linkedJuniors,
}: {
  dependents: UserDetail["dependents"];
  linkedJuniors: UserDetail["linkedJuniors"];
}) {
  const total = dependents.length + linkedJuniors.length;
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-stone-900">
        Junior Members ({total})
      </h3>
      {total === 0 ? (
        <p className="text-sm text-stone-500">No junior members.</p>
      ) : (
        <div className="space-y-4">
          {dependents.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                Registered dependents
              </p>
              {dependents.map((dep) => (
                <DependentCard key={dep.id} dependent={dep} />
              ))}
            </div>
          )}
          {linkedJuniors.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                Linked junior members
              </p>
              {linkedJuniors.map((j) => (
                <LinkedJuniorCard key={j.memberId} junior={j} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LinkedJuniorCard({
  junior,
}: {
  junior: UserDetail["linkedJuniors"][number];
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold">{junior.name ?? "(no name)"}</span>
        <Badge
          variant="outline"
          className="border-blue-300 text-xs text-blue-700"
        >
          Linked account
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="text-stone-500">Email</span>
          <p>{junior.email}</p>
        </div>
        {junior.dob && (
          <div>
            <span className="text-stone-500">DOB</span>
            <p>{junior.dob}</p>
          </div>
        )}
      </div>
    </div>
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

  const fields = buildDependentFields(dependent);

  return (
    <div className="rounded-md border border-stone-200 p-3">
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
        {fields.flatMap((f) =>
          f.value !== null
            ? [
                <div key={f.label}>
                  <span className="text-stone-500">{f.label}</span>
                  <p>{f.value}</p>
                </div>,
              ]
            : [],
        )}
      </div>
      {dependent.medical_info && (
        <div className="mt-2 text-sm">
          <span className="text-stone-500">Medical Info</span>
          <p className="whitespace-pre-wrap">{dependent.medical_info}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 9. Payments Section                                                 */
/* ------------------------------------------------------------------ */

function PaymentsSection({
  userId,
  charges,
}: {
  userId: string;
  charges: UserDetail["charges"];
}) {
  const queryClient = useQueryClient();
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
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
      setDescription("");
      setAmount("");
      setChargeDate(new Date().toISOString().split("T")[0]);
      setShowForm(false);
    },
  });

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const parsed = parseNewChargeForm({ description, amount, chargeDate });
    if (!parsed.ok) return;
    createCharge.mutate({
      description: parsed.description,
      amountPence: parsed.amountPence,
      chargeDate: parsed.chargeDate,
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">Payments</h3>
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
          className="mb-4 space-y-3 rounded-md border border-stone-200 p-3"
        >
          <div>
            <label
              htmlFor="member-charge-description"
              className="mb-1 block text-sm text-stone-600"
            >
              Description
            </label>
            <Input
              id="member-charge-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="member-charge-amount"
                className="mb-1 block text-sm text-stone-600"
              >
                Amount (GBP)
              </label>
              <Input
                id="member-charge-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="member-charge-date"
                className="mb-1 block text-sm text-stone-600"
              >
                Date
              </label>
              <Input
                id="member-charge-date"
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
        <p className="text-sm text-stone-500">No charges recorded.</p>
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
              <ChargeRow key={charge.id} charge={charge} userId={userId} />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ChargeRow({
  charge,
  userId,
}: {
  charge: UserDetail["charges"][number];
  userId: string;
}) {
  const queryClient = useQueryClient();
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
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
      setShowDelete(false);
    },
  });

  const canDelete = canDeleteCharge(charge);
  const status = getChargeStatus(charge);

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
              placeholder="Reason…"
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
/* 6a. Linked Parents Section                                          */
/* ------------------------------------------------------------------ */

function LinkedParentsSection({
  userId,
  memberId,
  linkedParents,
}: {
  userId: string;
  memberId: string;
  linkedParents: UserDetail["linkedParents"];
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const unlinkMutation = useMutation({
    mutationFn: (parentMemberId: string) =>
      callApi(
        api.POST("/api/admin/members/parent-unlink", {
          body: { memberId, parentMemberId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
    },
  });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">
          Linked Parents ({linkedParents.length})
        </h3>
        <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
          Link to parent
        </Button>
      </div>
      <p className="mb-3 text-xs text-stone-500">
        Charges raised against this member will surface on the linked
        parent(s)&apos; outstanding payments instead of this member&apos;s.
      </p>
      {linkedParents.length === 0 ? (
        <p className="text-sm text-stone-500">No linked parents.</p>
      ) : (
        <div className="space-y-2">
          {linkedParents.map((p) => (
            <div
              key={p.memberId}
              className="flex items-center justify-between rounded-md border border-stone-200 p-3 text-sm"
            >
              <div>
                <span className="font-medium">{p.name ?? "(no name)"}</span>
                <span className="ml-2 text-stone-500">{p.email}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => unlinkMutation.mutate(p.memberId)}
                disabled={unlinkMutation.isPending}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                Unlink
              </Button>
            </div>
          ))}
        </div>
      )}

      {pickerOpen && (
        <ParentLinkDialog
          userId={userId}
          memberId={memberId}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}

function ParentLinkDialog({
  userId,
  memberId,
  onClose,
}: {
  userId: string;
  memberId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebounced(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const {
    data: candidatesData,
    isLoading: candidatesLoading,
    error: candidatesError,
  } = useQuery({
    queryKey: ["admin", "parentSearch", memberId, debounced],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/members/parent-search", {
          params: {
            query: {
              juniorMemberId: memberId,
              ...(debounced ? { search: debounced } : {}),
            },
          },
        }),
      ),
  });

  const linkMutation = useMutation({
    mutationFn: (parentMemberId: string) =>
      callApi(
        api.POST("/api/admin/members/parent-link", {
          body: { memberId, parentMemberId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
      onClose();
    },
  });

  const members = candidatesData?.members ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to parent</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-stone-500">
          Pick a parent member. Once linked, this member&apos;s charges will
          surface on the parent&apos;s outstanding payments list.
        </p>

        <Input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-2"
        />

        {candidatesLoading && (
          <p className="text-sm text-stone-500">Searching…</p>
        )}
        {candidatesError && (
          <p className="text-sm text-red-600">Failed to search members.</p>
        )}

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {members.length === 0 && !candidatesLoading && (
            <p className="py-2 text-center text-sm text-stone-500">
              No matching members.
            </p>
          )}
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded px-3 py-2 hover:bg-stone-50"
            >
              <div>
                <span className="font-medium">{m.name ?? "(no name)"}</span>
                <span className="ml-2 text-xs text-stone-500">{m.email}</span>
                {m.score >= 0.7 && (
                  <Badge
                    variant="outline"
                    className="ml-2 border-green-300 text-green-700"
                  >
                    Strong match
                  </Badge>
                )}
                {m.score >= 0.4 && m.score < 0.7 && (
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
                onClick={() => linkMutation.mutate(m.id)}
                disabled={linkMutation.isPending}
              >
                Link
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* 10. Archive / Restore Section                                       */
/* ------------------------------------------------------------------ */

function ArchiveSection({
  userId,
  member,
}: {
  userId: string;
  member: UserDetail["member"];
}) {
  const queryClient = useQueryClient();
  const isArchived = isMemberArchived(member);
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
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "userDetail", userId],
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "listUsers"] });
    },
  });

  if (isArchived) {
    return (
      <section>
        <h3 className="mb-3 text-sm font-semibold text-stone-900">
          Archive Status
        </h3>
        <p className="mb-3 text-sm text-stone-500">
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
      <h3 className="mb-3 text-sm font-semibold text-stone-900">
        Archive Status
      </h3>
      <p className="mb-3 text-sm text-stone-500">
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
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder="Reason for archiving…"
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
