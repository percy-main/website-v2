import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { formatDate, isPast, parseISO } from "date-fns";
import { Link } from "react-router";
import { match } from "ts-pattern";

// TODO: hasOwnAccount is returned at runtime but missing from the OpenAPI
// spec. Remove this extension once the spec is updated.
interface DependentExtension {
  hasOwnAccount: boolean;
}

export function Membership() {
  const query = useQuery({
    queryKey: ["membership"],
    queryFn: () => callApi(api.GET("/api/members/me/membership")),
  });

  const dependentsQuery = useQuery({
    queryKey: ["dependents"],
    queryFn: () => callApi(api.GET("/api/junior/dependents")),
  });

  if (query.isLoading) return null;

  if (query.isError) {
    return (
      <p className="text-sm text-red-600">
        Failed to load membership details. Please try again later.
      </p>
    );
  }

  if (!query.data) {
    return null;
  }

  const { membership } = query.data;
  type Dependent = NonNullable<
    typeof dependentsQuery.data
  >["dependents"][number];
  const deps = (dependentsQuery.data?.dependents ?? []) as Array<
    Dependent & DependentExtension
  >;

  return (
    <section>
      <h2 className="text-h4">Your Membership</h2>
      <div className="max-w-max rounded-2xl border border-stone-500 bg-blue-100 p-4">
        {membership ? (
          <>
            <div className="mb-2 font-semibold">
              {match(membership.type)
                .with("senior_player", () => "Playing Member (Senior)")
                .with("senior_women_player", () => "Playing Member (Women's)")
                .with("social", () => "Social Member")
                .with("junior", () => "Junior Member")
                .with("concessionary", () => "Student / Concessionary Member")
                .otherwise(() => "Member")}
            </div>
            <p className="text-sm">
              <span className="font-semibold">Member Since: </span>
              {formatDate(membership.created_at, "dd/MM/yyyy")}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Paid Until: </span>
              {formatDate(membership.paid_until, "dd/MM/yyyy")}
            </p>
            {isPast(parseISO(membership.paid_until)) && (
              <Link
                className="mt-3 inline-block rounded-lg border border-blue-700 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus:ring-4 focus:ring-blue-300 focus:outline-none"
                to="/membership/pay"
              >
                Renew Membership
              </Link>
            )}
          </>
        ) : (
          <>
            <div className="mb-2 font-semibold">No Membership</div>
            <Link className="hover:underline" to="/membership/join">
              Join Now
            </Link>
          </>
        )}
      </div>

      {deps.length > 0 && (
        <div className="mt-6">
          <h3 className="text-h5 mb-2">Junior Members</h3>
          <div className="flex flex-col gap-3">
            {deps.map((dep) => (
              <div
                key={dep.id}
                className="max-w-max rounded-2xl border border-stone-500 bg-green-50 p-4"
              >
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  {dep.name}
                  {dep.hasOwnAccount && (
                    <span className="group relative inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Has own account
                      <svg
                        className="size-3.5 cursor-help text-blue-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth="2"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                        />
                      </svg>
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-stone-200 bg-white p-3 text-xs font-normal text-stone-700 shadow-lg group-hover:block">
                        Your child has their own account on our website. If you
                        aren&apos;t happy for your child to have their own
                        account, please contact us.
                      </span>
                    </span>
                  )}
                </div>
                <p className="text-sm">
                  <span className="font-semibold">Date of Birth: </span>
                  {formatDate(dep.dob, "dd/MM/yyyy")}
                </p>
                {dep.school_year && (
                  <p className="text-sm">
                    <span className="font-semibold">School Year: </span>
                    {dep.school_year}
                  </p>
                )}
                {dep.paid_until ? (
                  <p className="text-sm">
                    <span className="font-semibold">Paid Until: </span>
                    {formatDate(dep.paid_until, "dd/MM/yyyy")}
                  </p>
                ) : (
                  <p className="text-sm text-amber-600">Awaiting payment</p>
                )}
                {dep.photo_consent !== null && (
                  <p className="text-sm">
                    <span className="font-semibold">Photo Consent: </span>
                    {dep.photo_consent ? "Yes" : "No"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <Link
          className="inline-block rounded-lg border border-blue-700 bg-white px-5 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 focus:ring-4 focus:ring-blue-300 focus:outline-none"
          to="/membership/junior"
        >
          Register Junior Members
        </Link>
      </div>
    </section>
  );
}
