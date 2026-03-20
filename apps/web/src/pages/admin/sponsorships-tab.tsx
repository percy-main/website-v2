import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { useState } from "react";
import { formatDate, formatPence } from "./status-pill";

const PAGE_SIZE = 20;

type SubTab = "game" | "player";
type FilterValue = "all" | "pending_payment" | "pending_approval" | "approved";

interface GameSponsorship {
  id: string;
  game_id: string;
  sponsor_name: string;
  sponsor_email: string;
  sponsor_website: string | null;
  sponsor_logo_url: string | null;
  sponsor_message: string | null;
  amount_pence: number;
  approved: boolean;
  paid_at: string | null;
  display_name: string | null;
  notes: string | null;
  created_at: string;
}

interface PlayerSponsorship {
  id: string;
  slug: string | null;
  player_name: string;
  season: string;
  sponsor_name: string;
  sponsor_email: string;
  sponsor_website: string | null;
  sponsor_logo_url: string | null;
  sponsor_message: string | null;
  amount_pence: number;
  approved: boolean;
  paid_at: string | null;
  display_name: string | null;
  notes: string | null;
  created_at: string;
}

interface SponsorshipListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function SponsorshipStatus({
  paid_at,
  approved,
}: {
  paid_at: string | null;
  approved: boolean;
}) {
  if (!paid_at) return <Badge variant="warning">Pending Payment</Badge>;
  if (!approved) return <Badge variant="info">Pending Approval</Badge>;
  return <Badge variant="success">Approved</Badge>;
}

function InlineEdit({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 w-32 text-xs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(draft.trim() || null);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={() => {
            onSave(draft.trim() || null);
            setEditing(false);
          }}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (value) {
    return (
      <button
        className="cursor-pointer text-left text-xs text-gray-700 hover:underline"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }

  return (
    <button
      className="cursor-pointer text-xs text-blue-600 hover:underline"
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
    >
      {placeholder}
    </button>
  );
}

function SponsorColumn({
  name,
  email,
  website,
  logoUrl,
}: {
  name: string;
  email: string;
  website: string | null;
  logoUrl: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-bold">{name}</div>
      <div className="text-xs text-gray-500">{email}</div>
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          {website}
        </a>
      )}
      {logoUrl && (
        <img
          src={logoUrl}
          alt={`${name} logo`}
          className="h-8 max-w-[80px] object-contain"
        />
      )}
    </div>
  );
}

function CreateGameSponsorshipDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [gameId, setGameId] = useState("");
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorEmail, setSponsorEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post("/sponsorship/admin/game/manual", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
      resetForm();
      onOpenChange(false);
    },
  });

  function resetForm() {
    setGameId("");
    setSponsorName("");
    setSponsorEmail("");
    setWebsite("");
    setMessage("");
    setAmount("");
    setDisplayName("");
    setNotes("");
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const amountPence = Math.round(parseFloat(amount) * 100);
    createMutation.mutate({
      gameId,
      sponsorName,
      sponsorEmail,
      ...(website ? { sponsorWebsite: website } : {}),
      ...(message ? { sponsorMessage: message } : {}),
      amountPence,
      ...(displayName ? { displayName } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Game Sponsorship</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Game ID</label>
            <Input
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Sponsor Name
            </label>
            <Input
              value={sponsorName}
              onChange={(e) => setSponsorName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Sponsor Email
            </label>
            <Input
              type="email"
              value={sponsorEmail}
              onChange={(e) => setSponsorEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Website URL
            </label>
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Message</label>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 100))}
              placeholder="Optional (max 100 chars)"
              maxLength={100}
            />
            <div className="mt-0.5 text-right text-xs text-gray-400">
              {message.length}/100
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Amount (GBP)
            </label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step={0.01}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Display Name
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GameSponsorshipsTable({ filter }: { filter: FilterValue }) {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("pageSize", String(PAGE_SIZE));
  if (filter !== "all") queryParams.set("filter", filter);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "gameSponsorships", page, filter],
    queryFn: () =>
      api.get<SponsorshipListResponse<GameSponsorship>>(
        `/sponsorship/admin/game?${queryParams.toString()}`,
      ),
  });

  const approveMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      api.post("/sponsorship/admin/game/approve", { sponsorshipId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      api.post("/sponsorship/admin/game/reject", { sponsorshipId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      sponsorshipId,
      ...body
    }: {
      sponsorshipId: string;
      displayName?: string | null;
      notes?: string | null;
    }) =>
      api.put(`/sponsorship/admin/game/${sponsorshipId}`, {
        sponsorshipId,
        ...body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return <div className="py-12 text-center text-gray-500">Loading...</div>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Game</TableHead>
            <TableHead>Sponsor</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Paid</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.game_id}</TableCell>
              <TableCell>
                <SponsorColumn
                  name={s.sponsor_name}
                  email={s.sponsor_email}
                  website={s.sponsor_website}
                  logoUrl={s.sponsor_logo_url}
                />
              </TableCell>
              <TableCell>
                {s.sponsor_message ? (
                  <span className="italic">"{s.sponsor_message}"</span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </TableCell>
              <TableCell>{formatPence(s.amount_pence)}</TableCell>
              <TableCell>
                <SponsorshipStatus paid_at={s.paid_at} approved={s.approved} />
              </TableCell>
              <TableCell>{s.paid_at ? formatDate(s.paid_at) : "-"}</TableCell>
              <TableCell>
                <div className="space-y-1">
                  <InlineEdit
                    value={s.display_name}
                    placeholder="Set display name"
                    onSave={(v) =>
                      updateMutation.mutate({
                        sponsorshipId: s.id,
                        displayName: v,
                      })
                    }
                  />
                  <InlineEdit
                    value={s.notes}
                    placeholder="Add notes"
                    onSave={(v) =>
                      updateMutation.mutate({
                        sponsorshipId: s.id,
                        notes: v,
                      })
                    }
                  />
                </div>
              </TableCell>
              <TableCell>
                {s.paid_at && !s.approved && (
                  <Button
                    size="sm"
                    className="bg-green-600 text-white hover:bg-green-700"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(s.id)}
                  >
                    Approve
                  </Button>
                )}
                {s.approved && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate(s.id)}
                  >
                    Revoke
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {data?.items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-12 text-center text-gray-500"
              >
                No game sponsorships found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            {data.total} sponsorships total
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
    </>
  );
}

function PlayerSponsorshipsTable({ filter }: { filter: FilterValue }) {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("pageSize", String(PAGE_SIZE));
  if (filter !== "all") queryParams.set("filter", filter);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "playerSponsorships", page, filter],
    queryFn: () =>
      api.get<SponsorshipListResponse<PlayerSponsorship>>(
        `/sponsorship/admin/player?${queryParams.toString()}`,
      ),
  });

  const approveMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      api.post("/sponsorship/admin/player/approve", { sponsorshipId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "playerSponsorships"],
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      api.post("/sponsorship/admin/player/reject", { sponsorshipId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "playerSponsorships"],
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      sponsorshipId,
      ...body
    }: {
      sponsorshipId: string;
      displayName?: string | null;
      notes?: string | null;
    }) =>
      api.put(`/sponsorship/admin/player/${sponsorshipId}`, {
        sponsorshipId,
        ...body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "playerSponsorships"],
      });
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return <div className="py-12 text-center text-gray-500">Loading...</div>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Sponsor</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Paid</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <div>
                  <div className="font-bold">{s.player_name}</div>
                  <div className="text-xs text-gray-500">{s.season}</div>
                </div>
              </TableCell>
              <TableCell>
                <SponsorColumn
                  name={s.sponsor_name}
                  email={s.sponsor_email}
                  website={s.sponsor_website}
                  logoUrl={s.sponsor_logo_url}
                />
              </TableCell>
              <TableCell>
                {s.sponsor_message ? (
                  <span className="italic">"{s.sponsor_message}"</span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </TableCell>
              <TableCell>{formatPence(s.amount_pence)}</TableCell>
              <TableCell>
                <SponsorshipStatus paid_at={s.paid_at} approved={s.approved} />
              </TableCell>
              <TableCell>{s.paid_at ? formatDate(s.paid_at) : "-"}</TableCell>
              <TableCell>
                <div className="space-y-1">
                  <InlineEdit
                    value={s.display_name}
                    placeholder="Set display name"
                    onSave={(v) =>
                      updateMutation.mutate({
                        sponsorshipId: s.id,
                        displayName: v,
                      })
                    }
                  />
                  <InlineEdit
                    value={s.notes}
                    placeholder="Add notes"
                    onSave={(v) =>
                      updateMutation.mutate({
                        sponsorshipId: s.id,
                        notes: v,
                      })
                    }
                  />
                </div>
              </TableCell>
              <TableCell>
                {s.paid_at && !s.approved && (
                  <Button
                    size="sm"
                    className="bg-green-600 text-white hover:bg-green-700"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(s.id)}
                  >
                    Approve
                  </Button>
                )}
                {s.approved && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate(s.id)}
                  >
                    Revoke
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {data?.items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-12 text-center text-gray-500"
              >
                No player sponsorships found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            {data.total} sponsorships total
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
    </>
  );
}

export function SponsorshipsTab() {
  const [subTab, setSubTab] = useState<SubTab>("game");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Sub-tab toggle and controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Button
            variant={subTab === "game" ? "default" : "outline"}
            size="sm"
            onClick={() => setSubTab("game")}
          >
            Game Sponsorships
          </Button>
          <Button
            variant={subTab === "player" ? "default" : "outline"}
            size="sm"
            onClick={() => setSubTab("player")}
          >
            Player Sponsorships
          </Button>
        </div>

        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as FilterValue)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending_payment">Pending Payment</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
          </SelectContent>
        </Select>

        {subTab === "game" && (
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            Create Sponsorship
          </Button>
        )}
      </div>

      {/* Table */}
      {subTab === "game" ? (
        <GameSponsorshipsTable filter={filter} />
      ) : (
        <PlayerSponsorshipsTable filter={filter} />
      )}

      {/* Create Dialog */}
      <CreateGameSponsorshipDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
