import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "date-fns";

export function Subscriptions() {
  const query = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => callApi(api.GET("/api/members/me/subscriptions")),
  });

  if (!query.data) {
    return null;
  }

  return (
    <>
      <h2 className="text-h4 mb-0">Your Subscriptions</h2>
      <div className="w-full">
        {query.data.subscriptions.length === 0 && (
          <p>You have no subscriptions.</p>
        )}
        {query.data.subscriptions.map((subscription) => (
          <div
            key={`${subscription.product.name}-${subscription.created}`}
            className="flex flex-wrap items-center gap-y-4"
          >
            <dl className="w-1/2 sm:w-1/4 lg:w-auto lg:flex-1">
              <dt className="text-base font-medium text-stone-500">Name</dt>
              <dd className="mt-1.5 text-base font-semibold text-stone-900">
                {subscription.name ?? subscription.product.name}
              </dd>
            </dl>

            <dl className="w-1/2 sm:w-1/4 lg:w-auto lg:flex-1">
              <dt className="text-base font-medium text-stone-500">Created</dt>
              <dd className="mt-1.5 text-base font-semibold text-stone-900">
                {formatDate(subscription.created, "dd/MM/yyyy HH:mm")}
              </dd>
            </dl>

            <dl className="w-1/2 sm:w-1/4 lg:w-auto lg:flex-1">
              <dt className="text-base font-medium text-stone-500">Status</dt>
              <dd className="mt-1.5 text-base font-semibold text-stone-900">
                {subscription.status}
              </dd>
            </dl>

            <dl className="w-1/2 sm:w-1/4 lg:w-auto lg:flex-1">
              <dt className="text-base font-medium text-stone-500">
                Paid Until
              </dt>
              <dd className="mt-1.5 text-base font-semibold text-stone-900">
                {formatDate(subscription.paidUntil, "dd/MM/yyyy HH:mm")}
              </dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
