import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "date-fns";

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Charges() {
  const query = useQuery({
    queryKey: ["myCharges"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });

  const charges = query.data?.charges;

  if (query.isLoading) {
    return null;
  }

  if (!charges || charges.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-h4 mb-0">Payments</h2>
        <p className="text-sm text-gray-500">No payments yet.</p>
      </div>
    );
  }

  const unpaidCharges = charges.filter(
    (c) => !c.paid_at && !c.payment_confirmed_at,
  );
  const totalOutstandingPence = unpaidCharges.reduce(
    (sum, c) => sum + c.amount_pence,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-h4 mb-0">Payments</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {charges.map((charge) => (
            <TableRow key={charge.id}>
              <TableCell>
                {formatDate(charge.charge_date, "dd/MM/yyyy")}
              </TableCell>
              <TableCell>{charge.description}</TableCell>
              <TableCell>
                {currencyFormatter.format(charge.amount_pence / 100)}
              </TableCell>
              <TableCell>
                {charge.paid_at ? (
                  <Badge variant="success">Paid</Badge>
                ) : charge.payment_confirmed_at ? (
                  <Badge variant="info">Pending</Badge>
                ) : (
                  <Badge variant="warning">Unpaid</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {unpaidCharges.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-semibold">
                Outstanding balance:{" "}
                {currencyFormatter.format(totalOutstandingPence / 100)}
              </p>
              <p className="text-sm text-gray-500">
                {unpaidCharges.length} unpaid{" "}
                {unpaidCharges.length === 1 ? "payment" : "payments"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
