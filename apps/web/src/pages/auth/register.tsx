import { SimpleInput } from "@/components/form/simple-input.js";
import { Button } from "@/components/ui/button.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { authClient } from "@/lib/auth-client.js";
import { trackEvent } from "@/lib/marketing/gtag.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReducer, type FC } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

const GoogleIcon: FC = () => (
  <svg className="mr-2 size-5" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

interface RegisterFormState {
  name: string;
  email: string;
  password: string;
  ageConfirmed: boolean;
  ageError: boolean;
}

export function Component() {
  useDocumentMeta("Create an Account");
  const [searchParams] = useSearchParams();
  const [form, update] = useReducer(
    (s: RegisterFormState, p: Partial<RegisterFormState>) => ({ ...s, ...p }),
    {
      name: searchParams.get("name") ?? "",
      email: searchParams.get("email") ?? "",
      password: "",
      ageConfirmed: false,
      ageError: false,
    },
  );
  const { name, email, password, ageConfirmed, ageError } = form;
  const navigate = useNavigate();
  const returnTo = searchParams.get("returnTo");
  const queryClient = useQueryClient();

  const register = useMutation({
    mutationFn: () => {
      const emailConfirmedUrl = returnTo
        ? `${window.location.origin}/auth/email-confirmed?returnTo=${encodeURIComponent(returnTo)}`
        : `${window.location.origin}/auth/email-confirmed/`;
      return authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: emailConfirmedUrl,
      });
    },
    onSuccess(result) {
      if (!result.error) {
        trackEvent("sign_up", { method: "email" });
        // Session changed — drop cached anonymous queries.
        void queryClient.invalidateQueries();
        const registeredUrl = returnTo
          ? `/auth/registered?returnTo=${encodeURIComponent(returnTo)}`
          : "/auth/registered";
        void navigate(registeredUrl);
      }
    },
  });

  // Fire-and-forget: redirects out to Google's OAuth flow; the page reloads on
  // return, so there's no in-page cache to invalidate here.
  // eslint-disable-next-line react-doctor/query-mutation-missing-invalidation -- redirects out to Google OAuth and the page reloads on return
  const googleSignUp = useMutation({
    mutationFn: () =>
      authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}${returnTo ?? "/members"}`,
      }),
  });

  const handleGoogleClick = () => {
    googleSignUp.mutate();
  };

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!ageConfirmed) {
      update({ ageError: true });
      return;
    }
    update({ ageError: false });
    register.mutate();
  };

  const isUserExists =
    register.data?.error?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";
  const hasGenericError = register.data?.error && !isUserExists;

  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="space-y-4 p-6 sm:p-8 md:space-y-6">
        <h1 className="text-xl leading-tight font-semibold tracking-tight text-stone-900 md:text-2xl">
          Create an Account
        </h1>
        <p className="text-sm text-stone-600">
          Register to manage your membership, track payments, and access the
          members area.
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleClick}
          disabled={googleSignUp.isPending}
          className="w-full"
        >
          <GoogleIcon />
          Sign up with Google
        </Button>

        <div className="flex items-center">
          <div className="h-px flex-1 bg-stone-300" />
          <span className="px-4 text-sm text-stone-500">or</span>
          <div className="h-px flex-1 bg-stone-300" />
        </div>

        <form className="space-y-4 md:space-y-6" onSubmit={handleSubmit}>
          <SimpleInput
            id="name"
            type="text"
            label="Name"
            value={name}
            onChange={(e) => update({ name: e.currentTarget.value })}
            required
          />
          <SimpleInput
            id="email"
            type="email"
            label="Email"
            value={email}
            onChange={(e) => update({ email: e.currentTarget.value })}
            required
            invalid={isUserExists}
            errorId="register-email-error"
          />
          <SimpleInput
            id="password"
            type="password"
            label="Password"
            value={password}
            onChange={(e) => update({ password: e.currentTarget.value })}
            required
          />

          {isUserExists && (
            <div
              id="register-email-error"
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
            >
              <p className="font-medium">
                An account with this email already exists.
              </p>
              <p className="mt-1">
                You can{" "}
                <Link to="/auth/login" className="font-medium underline">
                  sign in here
                </Link>
                , or{" "}
                <Link
                  to="/auth/reset-password"
                  className="font-medium underline"
                >
                  reset your password
                </Link>{" "}
                if you&apos;ve forgotten it.
              </p>
            </div>
          )}

          {hasGenericError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              <p>Something went wrong. Please try again.</p>
            </div>
          )}

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="age-confirmed"
              checked={ageConfirmed}
              onChange={(e) => {
                update({
                  ageConfirmed: e.target.checked,
                  ...(e.target.checked ? { ageError: false } : {}),
                });
              }}
              className="mt-1 size-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
              required
              aria-invalid={ageError}
              aria-describedby={ageError ? "age-error" : undefined}
            />
            <label htmlFor="age-confirmed" className="text-sm text-stone-700">
              I confirm I am aged 13 or over
            </label>
          </div>

          {ageError && (
            <div
              id="age-error"
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              <p>
                You must confirm you are aged 13 or over to create an account.
              </p>
            </div>
          )}

          <Button type="submit" className="w-full">
            Create Account
          </Button>

          <p className="text-sm font-light text-stone-500">
            Already have an account?{" "}
            <Link
              to={
                returnTo
                  ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
                  : "/auth/login"
              }
              className="font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
