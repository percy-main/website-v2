import { Link } from "react-router";

export function Component() {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-h1-sm md:text-h1 mb-4 text-stone-900">404</h1>
      <p className="mb-8 text-lg text-stone-600">
        Sorry, we couldn't find the page you're looking for.
      </p>
      <Link
        to="/"
        className="bg-primary hover:bg-primary-light inline-block rounded-lg px-8 py-3 text-lg font-medium text-white transition"
      >
        Go Home
      </Link>
    </div>
  );
}
