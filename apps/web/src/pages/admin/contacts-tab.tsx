import { Button } from "@/components/ui/button";
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
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "./status-pill";

const PAGE_SIZE = 20;

function truncateMessage(message: string, maxLength = 100): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + "…";
}

export function ContactsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-doctor/no-cascading-set-state -- both setters fire on debounce settle: committing the search and resetting pagination together. Combining them in a reducer would obscure the intent.
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "contactSubmissions", page, PAGE_SIZE, debouncedSearch],
    queryFn: () =>
      callApi(
        api.GET("/api/admin/contact-submissions", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
            },
          },
        }),
      ),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {isLoading && <p className="text-stone-500">Loading…</p>}
      {isError && <p className="text-red-600">Failed to load submissions.</p>}

      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.submissions.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-stone-500"
                  >
                    No submissions found.
                  </TableCell>
                </TableRow>
              )}
              {data.submissions.map((submission) => {
                const isExpanded = expandedId === submission.id;
                return (
                  <TableRow
                    key={submission.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : submission.id)
                    }
                  >
                    <TableCell className="font-medium">
                      {submission.name}
                    </TableCell>
                    <TableCell>{submission.email}</TableCell>
                    <TableCell>
                      {isExpanded ? (
                        <span className="whitespace-pre-wrap">
                          {submission.message}
                        </span>
                      ) : (
                        truncateMessage(submission.message)
                      )}
                    </TableCell>
                    <TableCell>{submission.page}</TableCell>
                    <TableCell>
                      {formatDate(submission.createdAt, true)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <span className="text-stone-500">
              {data.total} submission{data.total !== 1 ? "s" : ""} total
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-stone-600">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
