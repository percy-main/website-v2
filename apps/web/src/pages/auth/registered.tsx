import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { Link, useSearchParams } from "react-router";

export function Component() {
  useDocumentMeta("Registration Complete");
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  const loginUrl = returnTo
    ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/auth/login";

  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="space-y-4 p-6 text-center sm:p-8">
        <h1 className="text-xl leading-tight font-semibold tracking-tight text-stone-900 md:text-2xl">
          Registration complete
        </h1>
        <p className="text-stone-600">
          We&apos;ve sent a verification email to your inbox. Please click the
          link in the email to confirm your account.
        </p>
        <p className="text-sm text-stone-500">
          Already verified?{" "}
          <Link to={loginUrl} className="font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
