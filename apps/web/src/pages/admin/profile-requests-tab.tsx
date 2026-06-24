import { ContentBody } from "@/components/content-body.js";
import { OptimisedImage } from "@/components/optimised-image.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Label } from "@/components/ui/label.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { Textarea } from "@/components/ui/textarea.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

type ProposalDetail =
  paths["/api/admin/profile-proposals/{proposalId}"]["get"]["responses"][200]["content"]["application/json"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listQueryKey = ["admin", "profile-proposals"] as const;

export function ProfileRequestsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestParam = searchParams.get("request");
  const selectedId =
    requestParam && UUID_RE.test(requestParam) ? requestParam : null;

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id === null) params.delete("request");
    else params.set("request", id);
    setSearchParams(params, { replace: false });
  };

  const {
    data: listData,
    isPending: listPending,
    isError: listError,
  } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => callApi(api.GET("/api/admin/profile-proposals")),
  });

  if (selectedId) {
    return <ReviewPanel proposalId={selectedId} onBack={() => select(null)} />;
  }

  if (listPending) return <p>Loading...</p>;
  if (listError) {
    return <p className="text-destructive">Couldn&apos;t load proposals.</p>;
  }

  const { items } = listData;

  if (items.length === 0) {
    return (
      <p className="text-sm text-stone-600">
        No profile edits are waiting for review.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Profile</TableHead>
          <TableHead>Submitted by</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">{item.title}</TableCell>
            <TableCell>{item.proposedByName ?? "Unknown"}</TableCell>
            <TableCell>
              {new Date(item.createdAt).toLocaleDateString("en-GB")}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="outline"
                size="sm"
                onClick={() => select(item.id)}
              >
                Review
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReviewPanel({
  proposalId,
  onBack,
}: {
  proposalId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  const {
    data: detail,
    isPending: detailPending,
    isError: detailError,
  } = useQuery({
    queryKey: ["admin", "profile-proposals", proposalId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/profile-proposals/{proposalId}", {
          params: { path: { proposalId } },
        }),
      ),
  });

  const approve = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/profile-proposals/{proposalId}/approve", {
          params: { path: { proposalId } },
        }),
      ),
    onSuccess: () => {
      // The queue and (because approve applies the edit) the live public
      // profile both change.
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["content"] });
      onBack();
    },
  });

  const reject = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/profile-proposals/{proposalId}/reject", {
          params: { path: { proposalId } },
          body: { note: note.trim() === "" ? undefined : note.trim() },
        }),
      ),
    onSuccess: () => {
      setRejectOpen(false);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      onBack();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          &larr; Back to queue
        </Button>
      </div>

      {detailPending ? (
        <p>Loading...</p>
      ) : detailError ? (
        <p className="text-destructive">Couldn&apos;t load this proposal.</p>
      ) : (
        <Review detail={detail} />
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={() => approve.mutate()}
          disabled={
            approve.isPending || detailPending || detail?.status !== "pending"
          }
        >
          {approve.isPending ? "Approving..." : "Approve"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setRejectOpen(true)}
          disabled={detail?.status !== "pending"}
        >
          Reject
        </Button>
      </div>

      {approve.isError ? (
        <p className="text-destructive text-sm">
          {approve.error instanceof Error
            ? approve.error.message
            : "Couldn't approve this proposal."}
        </p>
      ) : null}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this edit</DialogTitle>
            <DialogDescription>
              The member is emailed when you reject. Add an optional note
              explaining why so they can put it right.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-note">Note (optional)</Label>
            <Textarea
              id="reject-note"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Please keep the bio under 100 words."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => reject.mutate()}
              disabled={reject.isPending}
            >
              {reject.isPending ? "Rejecting..." : "Reject edit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Review({ detail }: { detail: ProposalDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">{detail.title}</h3>
        <p className="text-sm text-stone-600">
          Proposed by {detail.proposedByName ?? "Unknown"} on{" "}
          {new Date(detail.createdAt).toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ProfileColumn
          heading="Current (live)"
          body={detail.current.body}
          photo={detail.current.photo}
          name={detail.title}
        />
        <ProfileColumn
          heading="Proposed"
          body={detail.proposed.body}
          photo={detail.proposed.photo}
          name={detail.title}
          highlight
        />
      </div>
    </div>
  );
}

function ProfileColumn({
  heading,
  body,
  photo,
  name,
  highlight,
}: {
  heading: string;
  body: ProposalDetail["current"]["body"];
  photo: ProposalDetail["current"]["photo"];
  name: string;
  highlight?: boolean;
}) {
  return (
    // fc-theme so the bio renders in the same poster styling the live profile
    // uses - the reviewer compares like-for-like with the published look.
    <div
      className={`fc-theme bg-body rounded-md border p-4 ${highlight ? "border-stone-800" : ""}`}
    >
      <p className="mb-3 text-sm font-medium tracking-wide text-stone-500 uppercase">
        {heading}
      </p>
      {photo ? (
        <OptimisedImage
          picture={photo}
          alt={name}
          className="mb-4 h-32 w-32 rounded-full object-cover"
          width={128}
          height={128}
        />
      ) : (
        <p className="mb-4 text-sm text-stone-500">No photo</p>
      )}
      <ContentBody body={body} />
    </div>
  );
}
