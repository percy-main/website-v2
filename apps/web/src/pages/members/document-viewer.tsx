import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";

export function Component() {
  useDocumentMeta("Review Document");
  const { documentId = "" } = useParams<{ documentId: string }>();
  const queryClient = useQueryClient();
  const authedKey = useAuthedQueryKey();
  const [agreed, setAgreed] = useState(false);

  const { data, isLoading, error } = useAuthedQuery({
    queryKey: ["document", documentId],
    queryFn: () =>
      callApi(
        api.GET("/api/documents/{documentId}", {
          params: { path: { documentId } },
        }),
      ),
    enabled: !!documentId,
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/documents/{documentId}/confirm", {
          params: { path: { documentId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: authedKey(["document", documentId]),
      });
      void queryClient.invalidateQueries({
        queryKey: authedKey(["myDocuments"]),
      });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="py-12 text-center text-stone-500">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="py-12 text-center text-stone-500">
          Document not found or not assigned to you.
        </div>
        <div className="text-center">
          <Link
            to="/members?tab=documents"
            className="text-blue-600 hover:underline"
          >
            Back to Documents
          </Link>
        </div>
      </div>
    );
  }

  const alreadyConfirmed = data.confirmedAt && !data.isOutdated;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-4">
        <Link
          to="/members?tab=documents"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Documents
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1>{data.title}</h1>
        <Badge variant="secondary">v{data.version}</Badge>
        {alreadyConfirmed && (
          <Badge variant="success">Confirmed (v{data.confirmedVersion})</Badge>
        )}
        {data.isOutdated && (
          <Badge variant="warning">
            Updated since your last confirmation (v{data.confirmedVersion})
          </Badge>
        )}
      </div>

      <div className="mb-6 overflow-hidden rounded border">
        <iframe
          src={data.signedUrl}
          title={data.title}
          className="h-[70vh] w-full"
        />
      </div>

      {!alreadyConfirmed && (
        <div className="rounded border bg-stone-50 p-4">
          <label htmlFor="document-agree" className="flex items-start gap-3">
            <Checkbox
              id="document-agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              I have read, understood, and agree to abide by this document.
            </span>
          </label>

          {confirmMutation.isError && (
            <div className="mt-2 text-sm text-red-600">
              {confirmMutation.error.message}
            </div>
          )}

          {confirmMutation.isSuccess && (
            <div className="mt-2 text-sm text-green-600">
              Document confirmed successfully.
            </div>
          )}

          <Button
            className="mt-3"
            disabled={
              !agreed || confirmMutation.isPending || confirmMutation.isSuccess
            }
            onClick={() => confirmMutation.mutate()}
          >
            {confirmMutation.isPending ? "Confirming…" : "Confirm"}
          </Button>
        </div>
      )}
    </div>
  );
}
