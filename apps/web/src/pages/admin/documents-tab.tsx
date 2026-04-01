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
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );
      const dataUrl = `data:application/pdf;base64,${base64}`;
      return callApi(
        api.POST("/api/admin/documents", {
          body: { title, file: dataUrl },
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
            <label className="mb-1 block text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Safeguarding Policy"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              PDF Document
            </label>
            <Input
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
              {mutation.isPending ? "Uploading..." : "Upload"}
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
  open,
  onOpenChange,
}: {
  documentId: string;
  currentTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(currentTitle);
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let fileDataUrl: string | undefined;
      if (file) {
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            "",
          ),
        );
        fileDataUrl = `data:application/pdf;base64,${base64}`;
      }
      return callApi(
        api.PUT("/api/admin/documents/{documentId}", {
          params: { path: { documentId } },
          body: {
            ...(title !== currentTitle ? { title } : {}),
            ...(fileDataUrl ? { file: fileDataUrl } : {}),
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
            <label className="mb-1 block text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Replace PDF (optional — uploading increments version)
            </label>
            <Input
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
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignUsersDialog({
  documentId,
  open,
  onOpenChange,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const assignAllMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/admin/documents/{documentId}/assign", {
          params: { path: { documentId } },
          body: { assignAllActive: true },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documents"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["admin", "documentDetail", documentId],
      });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Document</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Assign this document to all active members. Members who are already
          assigned will be skipped.
        </p>
        {assignAllMutation.isSuccess && (
          <div className="text-sm text-green-600">
            Assigned to {assignAllMutation.data.assigned} new members.
          </div>
        )}
        {assignAllMutation.isError && (
          <div className="text-sm text-red-600">
            {assignAllMutation.error.message}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => assignAllMutation.mutate()}
            disabled={assignAllMutation.isPending}
          >
            {assignAllMutation.isPending
              ? "Assigning..."
              : "Assign to All Active Members"}
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
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-gray-500">Loading...</div>
        ) : data ? (
          <>
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

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                Assign Users
              </Button>
              {!data.archivedAt && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => archiveMutation.mutate()}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending ? "Archiving..." : "Archive"}
                </Button>
              )}
            </div>

            <h3 className="text-sm font-medium">
              Assignments ({data.assignments.length})
            </h3>

            {data.assignments.length === 0 ? (
              <p className="text-sm text-gray-500">No users assigned yet.</p>
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
                      <TableCell>{a.userName ?? "—"}</TableCell>
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
                        {a.confirmedAt ? formatDate(a.confirmedAt) : "—"}
                      </TableCell>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <EditDocumentDialog
              documentId={documentId}
              currentTitle={data.title}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
            <AssignUsersDialog
              documentId={documentId}
              open={assignOpen}
              onOpenChange={setAssignOpen}
            />
          </>
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
    return <div className="py-12 text-center text-gray-500">Loading...</div>;
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
              className="cursor-pointer hover:bg-gray-50"
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
                className="py-12 text-center text-gray-500"
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
