import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useNavigate } from "react-router";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function Documents() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["myDocuments"],
    queryFn: () => callApi(api.GET("/api/documents")),
  });

  if (isLoading) {
    return <div className="py-8 text-center text-gray-500">Loading...</div>;
  }

  const needsReview =
    data?.documents.filter((d) => !d.confirmedAt || d.isOutdated) ?? [];
  const accepted =
    data?.documents.filter((d) => d.confirmedAt && !d.isOutdated) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-semibold">Needs Review</h2>
        {needsReview.length === 0 ? (
          <p className="text-sm text-gray-500">All documents are up to date.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {needsReview.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell>v{doc.version}</TableCell>
                  <TableCell>{formatDate(doc.assignedAt)}</TableCell>
                  <TableCell>
                    {doc.isOutdated ? (
                      <Badge variant="warning">
                        Updated since v{doc.confirmedVersion}
                      </Badge>
                    ) : (
                      <Badge variant="info">Unread</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() =>
                        void navigate(`/members/documents/${doc.documentId}`)
                      }
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Accepted</h2>
        {accepted.length === 0 ? (
          <p className="text-sm text-gray-500">No accepted documents yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Confirmed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accepted.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell>v{doc.version}</TableCell>
                  <TableCell>
                    {doc.confirmedAt ? formatDate(doc.confirmedAt) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="success">
                      Confirmed (v{doc.confirmedVersion})
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
