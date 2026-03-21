import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { Link } from "react-router";

export function Component() {
  useDocumentMeta("Email Confirmed");
  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="space-y-4 p-6 text-center sm:p-8">
        <h1 className="text-xl leading-tight font-bold tracking-tight text-gray-900 md:text-2xl">
          Email confirmed
        </h1>
        <p className="text-gray-600">
          Your email address has been verified. You can now sign in to your
          account.
        </p>
        <Link
          to="/auth/login"
          className="bg-dark text-body inline-block rounded-md px-4 py-2 text-sm font-medium shadow transition hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
