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
import { api, callApi } from "@/lib/api-client";
import { resizeLogo } from "@/lib/logo-resize";
import { getAllPeople } from "@/lib/people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useReducer, useRef, useState } from "react";
import {
  buildGameSponsorshipPayload,
  buildPlayerSponsorshipPayload,
  gameSponsorshipFormReducer,
  initialGameSponsorshipFormState,
  initialPlayerSponsorshipFormState,
  isPlayerSponsorshipReady,
  playerSponsorshipFormReducer,
  type GameSponsorshipPayload,
  type PlayerSponsorshipPayload,
} from "./sponsorships-tab.reducer";
import { formatDate, formatPence } from "./status-pill";

const PAGE_SIZE = 20;

type SubTab = "game" | "player";
type FilterValue = "all" | "pending_payment" | "pending_approval" | "approved";

function PlayerSelect({
  id,
  value,
  playerName,
  takenSlugs,
  onChange,
}: {
  id?: string;
  value: string;
  playerName: string;
  takenSlugs: Set<string>;
  onChange: (slug: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const available = useMemo(() => {
    return getAllPeople()
      .filter((p) => !p.hasLeftClub && !takenSlugs.has(p.slug))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [takenSlugs]);

  const filtered = query.trim()
    ? available.filter((p) =>
        p.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : available;

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <div className="border-border bg-muted/30 flex-1 rounded border px-3 py-2 text-sm">
          {playerName} <span className="text-stone-500">({value})</span>
        </div>
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => onChange("", "")}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setDropdownOpen(true);
        }}
        onFocus={() => setDropdownOpen(true)}
        onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
        placeholder="Search players…"
      />
      {dropdownOpen && (
        <div className="border-border bg-surface absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-500">
              {query.trim()
                ? "No matching players available"
                : "No players available"}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.slug}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p.slug, p.name);
                  setQuery("");
                  setDropdownOpen(false);
                }}
              >
                {p.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
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
        className="block cursor-pointer text-left text-xs text-stone-700 hover:underline"
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
      className="block cursor-pointer text-left text-xs text-blue-600 hover:underline"
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
    >
      {placeholder}
    </button>
  );
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function LogoEdit({
  logoUrl,
  alt,
  onChange,
}: {
  logoUrl: string | null;
  alt: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await resizeLogo(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      {logoUrl && (
        <img
          src={logoUrl}
          alt={alt}
          className="h-8 max-w-[80px] object-contain"
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e)}
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={busy}
          className="cursor-pointer text-xs text-blue-600 hover:underline disabled:opacity-50"
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? "Uploading…" : logoUrl ? "Change logo" : "Add logo"}
        </button>
        {logoUrl && (
          <button
            type="button"
            disabled={busy}
            className="cursor-pointer text-xs text-red-600 hover:underline disabled:opacity-50"
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            Remove
          </button>
        )}
      </div>
      {error && <div className="text-xs text-amber-600">{error}</div>}
    </div>
  );
}

function SponsorColumn({
  name,
  email,
  website,
  phone,
  logoUrl,
  onWebsiteChange,
  onPhoneChange,
  onLogoChange,
}: {
  name: string;
  email: string;
  website: string | null;
  phone: string | null;
  logoUrl: string | null;
  onWebsiteChange?: (value: string | null) => void;
  onPhoneChange?: (value: string | null) => void;
  onLogoChange?: (dataUrl: string | null) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-bold">{name}</div>
      <div className="text-xs text-stone-500">{email}</div>
      {onWebsiteChange ? (
        <div>
          <InlineEdit
            value={website}
            placeholder="Add website"
            onSave={onWebsiteChange}
          />
          {website && !isValidUrl(website) && (
            <div className="text-xs font-medium text-amber-600">
              Invalid URL: fix before approving
            </div>
          )}
        </div>
      ) : website ? (
        isValidUrl(website) ? (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            {website}
          </a>
        ) : (
          <span className="text-xs text-stone-500">{website}</span>
        )
      ) : null}
      {onPhoneChange ? (
        <div>
          <InlineEdit
            value={phone}
            placeholder="Add phone"
            onSave={onPhoneChange}
          />
        </div>
      ) : phone ? (
        <a
          href={`tel:${phone}`}
          className="text-xs text-blue-600 hover:underline"
        >
          {phone}
        </a>
      ) : null}
      {onLogoChange ? (
        <LogoEdit
          logoUrl={logoUrl}
          alt={`${name} logo`}
          onChange={onLogoChange}
        />
      ) : (
        logoUrl && (
          <img
            src={logoUrl}
            alt={`${name} logo`}
            className="h-8 max-w-[80px] object-contain"
          />
        )
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
  const [form, dispatch] = useReducer(
    gameSponsorshipFormReducer,
    initialGameSponsorshipFormState,
  );

  const createMutation = useMutation({
    mutationFn: (body: GameSponsorshipPayload) =>
      callApi(
        api.POST("/api/sponsorship/admin/game/manual", {
          body,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
      dispatch({ type: "reset" });
      onOpenChange(false);
    },
  });

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const payload = buildGameSponsorshipPayload(form);
    if (!payload) return;
    createMutation.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Game Sponsorship</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="sg-create-game-id"
              className="mb-1 block text-sm font-medium"
            >
              Game ID
            </label>
            <Input
              id="sg-create-game-id"
              value={form.gameId}
              onChange={(e) =>
                dispatch({ type: "setGameId", value: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-sponsor-name"
              className="mb-1 block text-sm font-medium"
            >
              Sponsor Name
            </label>
            <Input
              id="sg-create-sponsor-name"
              value={form.sponsorName}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "sponsorName",
                  value: e.target.value,
                })
              }
              required
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-sponsor-email"
              className="mb-1 block text-sm font-medium"
            >
              Sponsor Email
            </label>
            <Input
              id="sg-create-sponsor-email"
              type="email"
              value={form.sponsorEmail}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "sponsorEmail",
                  value: e.target.value,
                })
              }
              required
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-website"
              className="mb-1 block text-sm font-medium"
            >
              Website URL
            </label>
            <Input
              id="sg-create-website"
              value={form.website}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "website",
                  value: e.target.value,
                })
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-phone"
              className="mb-1 block text-sm font-medium"
            >
              Phone
            </label>
            <Input
              id="sg-create-phone"
              type="tel"
              value={form.phone}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "phone",
                  value: e.target.value,
                })
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-message"
              className="mb-1 block text-sm font-medium"
            >
              Message
            </label>
            <Input
              id="sg-create-message"
              value={form.message}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "message",
                  value: e.target.value,
                })
              }
              placeholder="Optional (max 100 chars)"
              maxLength={100}
            />
            <div className="mt-0.5 text-right text-xs text-stone-400">
              {form.message.length}/100
            </div>
          </div>
          <div>
            <label
              htmlFor="sg-create-amount"
              className="mb-1 block text-sm font-medium"
            >
              Amount (GBP)
            </label>
            <Input
              id="sg-create-amount"
              type="number"
              value={form.amount}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "amount",
                  value: e.target.value,
                })
              }
              min={0}
              step={0.01}
              required
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-display-name"
              className="mb-1 block text-sm font-medium"
            >
              Display Name
            </label>
            <Input
              id="sg-create-display-name"
              value={form.displayName}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "displayName",
                  value: e.target.value,
                })
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label
              htmlFor="sg-create-notes"
              className="mb-1 block text-sm font-medium"
            >
              Notes
            </label>
            <Input
              id="sg-create-notes"
              value={form.notes}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "notes",
                  value: e.target.value,
                })
              }
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
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreatePlayerSponsorshipDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, dispatch] = useReducer(
    playerSponsorshipFormReducer,
    initialPlayerSponsorshipFormState,
  );

  const takenSlugsQuery = useQuery({
    queryKey: ["admin", "playerSponsorships", "takenSlugs"],
    queryFn: () =>
      callApi(api.GET("/api/sponsorship/admin/player/taken-slugs", {})),
    enabled: open,
  });

  const takenSlugs = useMemo(
    () => new Set(takenSlugsQuery.data?.slugs ?? []),
    [takenSlugsQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (body: PlayerSponsorshipPayload) =>
      callApi(
        api.POST("/api/sponsorship/admin/player/manual", {
          body,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "playerSponsorships"],
      });
      dispatch({ type: "reset" });
      onOpenChange(false);
    },
  });

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!isPlayerSponsorshipReady(form)) return;
    const payload = buildPlayerSponsorshipPayload(form);
    if (!payload) return;
    createMutation.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Player Sponsorship</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="sp-create-player"
              className="mb-1 block text-sm font-medium"
            >
              Player
            </label>
            <PlayerSelect
              id="sp-create-player"
              value={form.slug}
              playerName={form.playerName}
              takenSlugs={takenSlugs}
              onChange={(nextSlug, nextName) =>
                dispatch({
                  type: "setPlayer",
                  slug: nextSlug,
                  playerName: nextName,
                })
              }
            />
            {takenSlugsQuery.isLoading && (
              <div className="mt-1 text-xs text-stone-500">
                Loading available players...
              </div>
            )}
          </div>
          <div>
            <label
              htmlFor="sp-create-sponsor-name"
              className="mb-1 block text-sm font-medium"
            >
              Sponsor Name
            </label>
            <Input
              id="sp-create-sponsor-name"
              value={form.sponsorName}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "sponsorName",
                  value: e.target.value,
                })
              }
              required
            />
          </div>
          <div>
            <label
              htmlFor="sp-create-sponsor-email"
              className="mb-1 block text-sm font-medium"
            >
              Sponsor Email
            </label>
            <Input
              id="sp-create-sponsor-email"
              type="email"
              value={form.sponsorEmail}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "sponsorEmail",
                  value: e.target.value,
                })
              }
              required
            />
          </div>
          <div>
            <label
              htmlFor="sp-create-website"
              className="mb-1 block text-sm font-medium"
            >
              Website URL
            </label>
            <Input
              id="sp-create-website"
              value={form.website}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "website",
                  value: e.target.value,
                })
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label
              htmlFor="sp-create-phone"
              className="mb-1 block text-sm font-medium"
            >
              Phone
            </label>
            <Input
              id="sp-create-phone"
              type="tel"
              value={form.phone}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "phone",
                  value: e.target.value,
                })
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label
              htmlFor="sp-create-message"
              className="mb-1 block text-sm font-medium"
            >
              Message
            </label>
            <Input
              id="sp-create-message"
              value={form.message}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "message",
                  value: e.target.value,
                })
              }
              placeholder="Optional (max 100 chars)"
              maxLength={100}
            />
            <div className="mt-0.5 text-right text-xs text-stone-400">
              {form.message.length}/100
            </div>
          </div>
          <div>
            <label
              htmlFor="sp-create-amount"
              className="mb-1 block text-sm font-medium"
            >
              Amount (GBP)
            </label>
            <Input
              id="sp-create-amount"
              type="number"
              value={form.amount}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "amount",
                  value: e.target.value,
                })
              }
              min={0}
              step={0.01}
              required
            />
          </div>
          <div>
            <label
              htmlFor="sp-create-display-name"
              className="mb-1 block text-sm font-medium"
            >
              Display Name
            </label>
            <Input
              id="sp-create-display-name"
              value={form.displayName}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "displayName",
                  value: e.target.value,
                })
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label
              htmlFor="sp-create-notes"
              className="mb-1 block text-sm font-medium"
            >
              Notes
            </label>
            <Input
              id="sp-create-notes"
              value={form.notes}
              onChange={(e) =>
                dispatch({
                  type: "setField",
                  field: "notes",
                  value: e.target.value,
                })
              }
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
            <Button
              type="submit"
              disabled={
                createMutation.isPending || !form.slug || !form.playerName
              }
            >
              {createMutation.isPending ? "Creating…" : "Create"}
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

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "gameSponsorships", page, filter],
    queryFn: () =>
      callApi(
        api.GET("/api/sponsorship/admin/game", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(filter !== "all" ? { filter } : {}),
            },
          },
        }),
      ),
  });

  const approveMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      callApi(
        api.POST("/api/sponsorship/admin/game/approve", {
          body: { sponsorshipId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      callApi(
        api.POST("/api/sponsorship/admin/game/reject", {
          body: { sponsorshipId },
        }),
      ),
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
      displayName?: string | undefined;
      notes?: string | undefined;
      sponsorWebsite?: string | null | undefined;
      sponsorPhone?: string | null | undefined;
      sponsorLogoDataUrl?: string | null | undefined;
    }) =>
      callApi(
        api.PUT("/api/sponsorship/admin/game/{sponsorshipId}", {
          params: { path: { sponsorshipId } },
          body: { sponsorshipId, ...body },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "gameSponsorships"],
      });
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return <div className="py-12 text-center text-stone-500">Loading…</div>;
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
                  phone={s.sponsor_phone}
                  logoUrl={s.sponsor_logo_url}
                  onWebsiteChange={(v) =>
                    updateMutation.mutate({
                      sponsorshipId: s.id,
                      sponsorWebsite: v,
                    })
                  }
                  onPhoneChange={(v) =>
                    updateMutation.mutate({
                      sponsorshipId: s.id,
                      sponsorPhone: v,
                    })
                  }
                  onLogoChange={(v) =>
                    updateMutation.mutate({
                      sponsorshipId: s.id,
                      sponsorLogoDataUrl: v,
                    })
                  }
                />
              </TableCell>
              <TableCell>
                {s.sponsor_message ? (
                  <span className="italic">"{s.sponsor_message}"</span>
                ) : (
                  <span className="text-stone-400">-</span>
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
                        displayName: v ?? undefined,
                      })
                    }
                  />
                  <InlineEdit
                    value={s.notes}
                    placeholder="Add notes"
                    onSave={(v) =>
                      updateMutation.mutate({
                        sponsorshipId: s.id,
                        notes: v ?? undefined,
                      })
                    }
                  />
                </div>
              </TableCell>
              <TableCell>
                {s.paid_at &&
                  !s.approved &&
                  (() => {
                    const hasInvalidUrl =
                      !!s.sponsor_website && !isValidUrl(s.sponsor_website);
                    return (
                      <div className="space-y-1">
                        <Button
                          size="sm"
                          className="bg-green-600 text-white hover:bg-green-700"
                          disabled={approveMutation.isPending || hasInvalidUrl}
                          onClick={() => approveMutation.mutate(s.id)}
                        >
                          Approve
                        </Button>
                        {hasInvalidUrl && (
                          <div className="text-xs text-amber-600">
                            Fix URL first
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                className="py-12 text-center text-stone-500"
              >
                No game sponsorships found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-600">
            {data.total} sponsorships total
          </span>
          <span className="text-sm text-stone-600">
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

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "playerSponsorships", page, filter],
    queryFn: () =>
      callApi(
        api.GET("/api/sponsorship/admin/player", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(filter !== "all" ? { filter } : {}),
            },
          },
        }),
      ),
  });

  const approveMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      callApi(
        api.POST("/api/sponsorship/admin/player/approve", {
          body: { sponsorshipId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "playerSponsorships"],
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (sponsorshipId: string) =>
      callApi(
        api.POST("/api/sponsorship/admin/player/reject", {
          body: { sponsorshipId },
        }),
      ),
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
      displayName?: string | undefined;
      notes?: string | undefined;
      sponsorWebsite?: string | null | undefined;
      sponsorPhone?: string | null | undefined;
      sponsorLogoDataUrl?: string | null | undefined;
    }) =>
      callApi(
        api.PUT("/api/sponsorship/admin/player/{sponsorshipId}", {
          params: { path: { sponsorshipId } },
          body: { sponsorshipId, ...body },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "playerSponsorships"],
      });
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return <div className="py-12 text-center text-stone-500">Loading…</div>;
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
                  <div className="text-xs text-stone-500">{s.season}</div>
                </div>
              </TableCell>
              <TableCell>
                <SponsorColumn
                  name={s.sponsor_name}
                  email={s.sponsor_email}
                  website={s.sponsor_website}
                  phone={s.sponsor_phone}
                  logoUrl={s.sponsor_logo_url}
                  onWebsiteChange={(v) =>
                    updateMutation.mutate({
                      sponsorshipId: s.id,
                      sponsorWebsite: v,
                    })
                  }
                  onPhoneChange={(v) =>
                    updateMutation.mutate({
                      sponsorshipId: s.id,
                      sponsorPhone: v,
                    })
                  }
                  onLogoChange={(v) =>
                    updateMutation.mutate({
                      sponsorshipId: s.id,
                      sponsorLogoDataUrl: v,
                    })
                  }
                />
              </TableCell>
              <TableCell>
                {s.sponsor_message ? (
                  <span className="italic">"{s.sponsor_message}"</span>
                ) : (
                  <span className="text-stone-400">-</span>
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
                        displayName: v ?? undefined,
                      })
                    }
                  />
                  <InlineEdit
                    value={s.notes}
                    placeholder="Add notes"
                    onSave={(v) =>
                      updateMutation.mutate({
                        sponsorshipId: s.id,
                        notes: v ?? undefined,
                      })
                    }
                  />
                </div>
              </TableCell>
              <TableCell>
                {s.paid_at &&
                  !s.approved &&
                  (() => {
                    const hasInvalidUrl =
                      !!s.sponsor_website && !isValidUrl(s.sponsor_website);
                    return (
                      <div className="space-y-1">
                        <Button
                          size="sm"
                          className="bg-green-600 text-white hover:bg-green-700"
                          disabled={approveMutation.isPending || hasInvalidUrl}
                          onClick={() => approveMutation.mutate(s.id)}
                        >
                          Approve
                        </Button>
                        {hasInvalidUrl && (
                          <div className="text-xs text-amber-600">
                            Fix URL first
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                className="py-12 text-center text-stone-500"
              >
                No player sponsorships found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-600">
            {data.total} sponsorships total
          </span>
          <span className="text-sm text-stone-600">
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
  const [createGameDialogOpen, setCreateGameDialogOpen] = useState(false);
  const [createPlayerDialogOpen, setCreatePlayerDialogOpen] = useState(false);

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

        {subTab === "game" ? (
          <Button size="sm" onClick={() => setCreateGameDialogOpen(true)}>
            Create Sponsorship
          </Button>
        ) : (
          <Button size="sm" onClick={() => setCreatePlayerDialogOpen(true)}>
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

      {/* Create Dialogs */}
      <CreateGameSponsorshipDialog
        open={createGameDialogOpen}
        onOpenChange={setCreateGameDialogOpen}
      />
      <CreatePlayerSponsorshipDialog
        open={createPlayerDialogOpen}
        onOpenChange={setCreatePlayerDialogOpen}
      />
    </div>
  );
}
