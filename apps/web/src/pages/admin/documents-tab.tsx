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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CreateDocumentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      // Step 1: Get pre-signed upload URL
      const { uploadUrl, pendingKey } = await callApi(
        api.POST("/api/admin/documents/upload-url"),
      );
      // Step 2: Upload PDF directly to S3
      const res = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/pdf" },
      });
      if (!res.ok) throw new Error("Failed to upload file");
      // Step 3: Create document record with pending key
      return callApi(
        api.POST("/api/admin/documents", {
          body: { title, pendingKey },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documents"],
      });
      setTitle("");
      setFile(null);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="upload-doc-title"
              className="mb-1 block text-sm font-medium"
            >
              Title
            </label>
            <Input
              id="upload-doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Safeguarding Policy"
              required
            />
          </div>
          <div>
            <label
              htmlFor="upload-doc-file"
              className="mb-1 block text-sm font-medium"
            >
              PDF Document
            </label>
            <Input
              id="upload-doc-file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          {mutation.isError && (
            <div className="text-sm text-red-600">{mutation.error.message}</div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !file}>
              {mutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDocumentDialog({
  documentId,
  currentTitle,
  currentVersion,
  open,
  onOpenChange,
}: {
  documentId: string;
  currentTitle: string;
  currentVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  // Seeded from `currentTitle` on mount; the parent passes a `key` tied to
  // (title, version) so a new doc opening remounts this dialog with fresh state.
  const [title, setTitle] = useState(() => currentTitle);
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let pendingKey: string | undefined;
      if (file) {
        // Step 1: Get pre-signed upload URL for next version
        const upload = await callApi(
          api.POST("/api/admin/documents/{documentId}/upload-url", {
            params: { path: { documentId } },
          }),
        );
        // Step 2: Upload PDF directly to S3
        const res = await fetch(upload.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": "application/pdf" },
        });
        if (!res.ok) throw new Error("Failed to upload file");
        pendingKey = upload.pendingKey;
      }
      return callApi(
        api.PUT("/api/admin/documents/{documentId}", {
          params: { path: { documentId } },
          body: {
            expectedVersion: currentVersion,
            ...(title !== currentTitle ? { title } : {}),
            ...(pendingKey ? { pendingKey } : {}),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documents"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documentDetail", documentId],
      });
      setFile(null);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Document</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="edit-doc-title"
              className="mb-1 block text-sm font-medium"
            >
              Title
            </label>
            <Input
              id="edit-doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="edit-doc-file"
              className="mb-1 block text-sm font-medium"
            >
              Replace PDF (optional; uploading increments version)
            </label>
            <Input
              id="edit-doc-file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {mutation.isError && (
            <div className="text-sm text-red-600">{mutation.error.message}</div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignUsersDialog({
  documentId,
  assignedUserIds,
  open,
  onOpenChange,
}: {
  documentId: string;
  assignedUserIds: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const { data: usersData } = useQuery({
    queryKey: ["admin", "listUsers", search],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/users", {
          params: {
            query: { page: 1, pageSize: 20, search: search || undefined },
          },
        }),
      ),
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: (body: { userIds?: string[]; assignAllActive?: boolean }) =>
      callApi(
        api.POST("/api/admin/documents/{documentId}/assign", {
          params: { path: { documentId } },
          body,
        }),
      ),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documents"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documentDetail", documentId],
      });
      setResultMessage(
        `Assigned to ${data.assigned} new member${data.assigned === 1 ? "" : "s"}.`,
      );
      setSelectedUserIds([]);
    },
  });

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setSearch("");
          setSelectedUserIds([]);
          setResultMessage(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Assign Document</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Button
              className="w-full"
              onClick={() => assignMutation.mutate({ assignAllActive: true })}
              disabled={assignMutation.isPending}
            >
              {assignMutation.isPending
                ? "Assigning…"
                : "Assign to All Active Members"}
            </Button>
          </div>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-stone-300" />
            <span className="mx-3 text-xs text-stone-500">
              or select individuals
            </span>
            <div className="flex-grow border-t border-stone-300" />
          </div>

          <Input
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-48 overflow-y-auto rounded border">
            {usersData?.items.flatMap((u) =>
              assignedUserIds.has(u.id)
                ? []
                : [
                    <label
                      key={u.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-stone-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(u.id)}
                        onChange={() => toggleUser(u.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{u.name ?? u.email}</span>
                      {u.name && (
                        <span className="text-xs text-stone-400">
                          {u.email}
                        </span>
                      )}
                    </label>,
                  ],
            )}
            {usersData?.items.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-stone-500">
                No members found.
              </div>
            )}
          </div>

          {selectedUserIds.length > 0 && (
            <Button
              onClick={() =>
                assignMutation.mutate({ userIds: selectedUserIds })
              }
              disabled={assignMutation.isPending}
            >
              {assignMutation.isPending
                ? "Assigning…"
                : `Assign to ${selectedUserIds.length} Selected`}
            </Button>
          )}

          {resultMessage && (
            <div className="text-sm text-green-600">{resultMessage}</div>
          )}
          {assignMutation.isError && (
            <div className="text-sm text-red-600">
              {assignMutation.error.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDetailModal({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "documentDetail", documentId],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/documents/{documentId}", {
          params: { path: { documentId } },
        }),
      ),
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/documents/{documentId}/archive", {
          params: { path: { documentId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documents"],
      });
      onClose();
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (userId: string) =>
      callApi(
        api.DELETE("/api/admin/documents/{documentId}/assign/{userId}", {
          params: { path: { documentId, userId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documentDetail", documentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documents"],
      });
    },
  });

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        {isLoading ? (
          <div className="py-8 text-center text-stone-500">Loading…</div>
        ) : data ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>{data.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-1 text-sm">
              <div>
                <strong>Version:</strong> {data.version}
              </div>
              <div>
                <strong>Created:</strong> {formatDate(data.createdAt)}
              </div>
              <div>
                <strong>Updated:</strong> {formatDate(data.updatedAt)}
              </div>
              {data.archivedAt && (
                <Badge variant="warning">
                  Archived {formatDate(data.archivedAt)}
                </Badge>
              )}
            </div>

            {!data.archivedAt && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
                <Button size="sm" onClick={() => setAssignOpen(true)}>
                  Assign Users
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => archiveMutation.mutate()}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending ? "Archiving…" : "Archive"}
                </Button>
              </div>
            )}

            <h3 className="text-sm font-medium">
              Assignments ({data.assignments.length})
            </h3>

            {data.assignments.length === 0 ? (
              <p className="text-sm text-stone-500">No users assigned yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Confirmed</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.userName ?? "-"}</TableCell>
                      <TableCell className="text-xs">{a.userEmail}</TableCell>
                      <TableCell>
                        {a.confirmedAt ? (
                          a.isOutdated ? (
                            <Badge variant="warning">
                              Outdated (v{a.confirmedVersion})
                            </Badge>
                          ) : (
                            <Badge variant="success">
                              Confirmed (v{a.confirmedVersion})
                            </Badge>
                          )
                        ) : (
                          <Badge variant="info">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.confirmedAt ? formatDate(a.confirmedAt) : "-"}
                      </TableCell>
                      {!data.archivedAt && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-red-600"
                            onClick={() => unassignMutation.mutate(a.userId)}
                            disabled={unassignMutation.isPending}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {data.history.length > 0 && (
              <>
                <h3 className="text-sm font-medium">
                  Version History ({data.history.length})
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data.history].reverse().map((h, i) => (
                      <TableRow key={h.version}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            v{h.version}
                            {i === 0 && <Badge variant="success">Latest</Badge>}
                          </span>
                        </TableCell>
                        <TableCell>{h.title}</TableCell>
                        <TableCell>{formatDateTime(h.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}

            <EditDocumentDialog
              key={`${data.title}-${data.version}`}
              documentId={documentId}
              currentTitle={data.title}
              currentVersion={data.version}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
            <AssignUsersDialog
              documentId={documentId}
              assignedUserIds={new Set(data.assignments.map((a) => a.userId))}
              open={assignOpen}
              onOpenChange={setAssignOpen}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "documents"],
    queryFn: () => callApi(api.GET("/api/admin/documents")),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-stone-500">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Documents</h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Upload Document
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Assigned</TableHead>
            <TableHead>Confirmed</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.documents.map((doc) => (
            <TableRow
              key={doc.id}
              className="cursor-pointer hover:bg-stone-50"
              onClick={() => setSelectedDocId(doc.id)}
            >
              <TableCell className="font-medium">{doc.title}</TableCell>
              <TableCell>v{doc.version}</TableCell>
              <TableCell>{doc.assignedCount}</TableCell>
              <TableCell>{doc.confirmedCount}</TableCell>
              <TableCell>{formatDate(doc.updatedAt)}</TableCell>
              <TableCell>
                {doc.archivedAt ? (
                  <Badge variant="warning">Archived</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {data?.documents.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-12 text-center text-stone-500"
              >
                No documents yet. Upload one to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <CreateDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />

      {selectedDocId && (
        <DocumentDetailModal
          documentId={selectedDocId}
          onClose={() => setSelectedDocId(null)}
        />
      )}
    </div>
  );
}
