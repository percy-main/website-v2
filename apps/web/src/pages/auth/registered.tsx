import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { Link } from "react-router";

export function Component() {
  useDocumentMeta("Registration Complete");
  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="space-y-4 p-6 text-center sm:p-8">
        <h1 className="text-xl leading-tight font-bold tracking-tight text-gray-900 md:text-2xl">
          Registration complete
        </h1>
        <p className="text-gray-600">
          We&apos;ve sent a verification email to your inbox. Please click the
          link in the email to confirm your account.
        </p>
        <p className="text-sm text-gray-500">
          Already verified?{" "}
          <Link to="/auth/login" className="font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
