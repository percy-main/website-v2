import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { formatPence } from "./status-pill";
import { daysOverdue } from "./treasurer-tab.lib";

const PAGE_SIZE = 20;

/**
 * Outstanding Payments card — paginated list with per-row "Chase" action
 * (sends a payment-reminder email for that charge after a confirm step).
 *
 * Owns its own query, page state, chasing-row state, and chase mutation
 * so TreasurerTab no longer hosts these concerns.
 */
export function TreasurerOutstandingSection() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [chasingId, setChasingId] = useState<string | null>(null);

  const outstandingQuery = useQuery({
    queryKey: ["treasurer", "outstanding-payments", page],
    queryFn: () =>
      callApi(
        api.GET("/api/treasurer/outstanding-payments", {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
            },
          },
        }),
      ),
  });

  const chaseMutation = useMutation({
    mutationFn: (chargeId: string) =>
      callApi(
        api.POST("/api/admin/chase-payment", {
          body: { chargeId },
        }),
      ),
    onSuccess: () => {
      setChasingId(null);
      void queryClient.invalidateQueries({
        queryKey: ["treasurer", "outstanding-payments"],
      });
    },
  });

  const totalPages = outstandingQuery.data
    ? Math.ceil(outstandingQuery.data.total / PAGE_SIZE)
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Outstanding Payments</CardTitle>
      </CardHeader>
      <CardContent>
        {outstandingQuery.isLoading ? (
          <p className="py-8 text-center text-stone-500">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Days Overdue</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outstandingQuery.data?.items.map((item) => {
                const days = daysOverdue(item.charge_date);
                const overdueBadgeVariant =
                  days > 30 ? "destructive" : days > 7 ? "warning" : "default";

                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div>{item.member_name}</div>
                      <div className="text-xs text-stone-500">
                        {item.member_email}
                      </div>
                    </TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-right">
                      {formatPence(item.amount_pence)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={overdueBadgeVariant}>{days}d</Badge>
                    </TableCell>
                    <TableCell>
                      {chasingId === item.id ? (
                        <div className="flex gap-1">
                          <Button
                            variant="default"
                            size="sm"
                            disabled={
                              chaseMutation.isPending || !item.member_email
                            }
                            onClick={() => chaseMutation.mutate(item.id)}
                          >
                            Send
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setChasingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setChasingId(item.id)}
                        >
                          Chase
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {outstandingQuery.data?.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-stone-500"
                  >
                    No outstanding payments.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {outstandingQuery.data && outstandingQuery.data.total > 0 && (
        <CardFooter className="flex items-center justify-between">
          <span className="text-sm text-stone-600">
            {outstandingQuery.data.total} payment(s) total
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
        </CardFooter>
      )}
    </Card>
  );
}
