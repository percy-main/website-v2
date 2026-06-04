import { SimpleInput } from "@/components/form/simple-input.js";
import { Button } from "@/components/ui/button.js";
import { authClient, useSession } from "@/lib/auth-client.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FC } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { LoginPhase } from "../login.js";

interface Props {
  setPhase: (phase: LoginPhase) => void;
}

/**
 * Is `target` a fully-qualified URL pointing at one of our public
 * domains? We accept matchday.percymain.org and any other percymain.org
 * subdomain so the matchday PWA's RequireAuth can punt unauthenticated
 * visits here with `returnTo=https://matchday.percymain.org/...` and we
 * bounce them back. `localhost` is allowed so a dev round-trip works.
 *
 * Anything else (external URLs, non-http protocols) is rejected —
 * `returnTo` is an open-redirect vector if we don't validate.
 */
function isAllowedExternalReturnTo(target: string): boolean {
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    return false;
  }
  try {
    const url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname;
    if (host === "percymain.org" || host.endsWith(".percymain.org")) {
      return true;
    }
    if (host === "localhost" || host.endsWith(".localhost")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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

export const EmailPassword: FC<Props> = ({ setPhase }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const queryClient = useQueryClient();
  // better-auth's session atom only refetches via a setTimeout(10) after
  // sign-in, so a naive `navigate(returnTo)` arrives at the destination
  // BEFORE the new session is in the atom — RequireAuth sees data=null
  // and bounces straight back here. Awaiting refetch() forces the
  // /get-session call to complete before we navigate.
  const {
    data: session,
    isPending: sessionPending,
    refetch: refetchSession,
  } = useSession();

  /**
   * Send the user to their destination after a successful sign-in.
   * Allowed `returnTo` values:
   *  - a same-origin path → router-navigate (kept SPA-fast)
   *  - a full URL on .percymain.org (or localhost in dev) → window.location
   *    (crosses subdomain, so router can't help us)
   *  - anything else → fallback (typically /members)
   */
  const navigateBack = (fallback: string) => {
    const target = returnTo ?? fallback;
    if (isAllowedExternalReturnTo(target)) {
      window.location.href = target;
      return;
    }
    void navigate(target);
  };

  // Already signed in? Bounce straight to wherever returnTo points (or
  // /members). Covers the case where a logged-in user clicks an old
  // bookmark for /auth/login or follows a stale matchday RequireAuth
  // redirect after the cookie has been refreshed in another tab.
  useEffect(() => {
    if (sessionPending) return;
    if (!session) return;
    navigateBack("/members");
    // navigateBack closes over returnTo; the eslint rule wants every
    // closed-over value listed but `returnTo` already covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionPending, returnTo]);

  useEffect(() => {
    let cancelled = false;
    async function tryPasskeyAutofill() {
      const available =
        await PublicKeyCredential?.isConditionalMediationAvailable?.();
      if (!available || cancelled) return;

      void authClient.signIn.passkey(
        { autoFill: true },
        {
          async onSuccess() {
            if (cancelled) return;
            // The post-await `cancelled` check guards against unmount
            // during the session refetch — it's not a redundant
            // pre-await guard, so the rule's "move await past it" advice
            // would break the abort-on-unmount contract.
            // eslint-disable-next-line react-doctor/async-defer-await
            await refetchSession();
            if (cancelled) return;
            navigateBack("/members");
          },
        },
      );
    }
    void tryPasskeyAutofill();
    return () => {
      cancelled = true;
    };
    // Run once on mount. Re-running this effect kicks off a fresh
    // WebAuthn conditional-mediation ceremony, aborts the previous one
    // client-side ("Cancelling existing WebAuthn API call for new one"),
    // and leaves the server's stored challenge out of sync with whatever
    // the user eventually completes, producing CHALLENGE_NOT_FOUND on
    // verify. better-auth's useSession returns a new `refetch` reference
    // on every session-atom update, so listing it in deps would re-trigger
    // the ceremony every time the session refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signin = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.email({ email, password });
      if (result.error)
        throw new Error(result.error.message ?? "Sign in failed");
      return result.data;
    },
    async onSuccess(data) {
      if (data && "twoFactorRedirect" in data) {
        setPhase("2fa");
        return;
      }
      await refetchSession();
      // Session changed — drop all cached queries so the new user sees fresh
      // data rather than the previous user's (or anonymous) cached responses.
      void queryClient.invalidateQueries();
      navigateBack("/members");
    },
  });

  // Fire-and-forget: redirects out to Google's OAuth flow; the page reloads on
  // return, so there's no in-page cache to invalidate here.
  // eslint-disable-next-line react-doctor/query-mutation-missing-invalidation -- redirects out to Google OAuth and the page reloads on return
  const googleSignIn = useMutation({
    mutationFn: () => {
      // For same-origin returns, prefix with current origin. For full
      // .percymain.org URLs (matchday redirect), pass through verbatim
      // — better-auth's social-login callbackURL accepts an absolute URL.
      const target = returnTo ?? "/members";
      const callbackURL = isAllowedExternalReturnTo(target)
        ? target
        : `${window.location.origin}${target}`;
      return authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
    },
  });

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    signin.mutate();
  };

  const error = signin.error ?? googleSignIn.error ?? googleSignIn.data?.error;

  return (
    <section>
      <h1 className="text-xl leading-tight font-semibold tracking-tight text-stone-900 md:text-2xl">
        Sign in to your account
      </h1>
      <div className="space-y-4 md:space-y-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => googleSignIn.mutate()}
          disabled={googleSignIn.isPending}
          className="w-full"
        >
          <GoogleIcon />
          Sign in with Google
        </Button>
        <div className="flex items-center">
          <div className="h-px flex-1 bg-stone-300" />
          <span className="px-4 text-sm text-stone-500">or</span>
          <div className="h-px flex-1 bg-stone-300" />
        </div>
        <form className="space-y-4 md:space-y-6" onSubmit={handleSubmit}>
          {/* Only credential (signin) failures mark these fields invalid -
              a Google sign-in error is form-level, not about these inputs. */}
          <SimpleInput
            id="email"
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            autoComplete="email webauthn"
            invalid={Boolean(signin.error)}
            errorId="login-error"
          />
          <SimpleInput
            id="password"
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            autoComplete="current-password webauthn"
            invalid={Boolean(signin.error)}
            errorId="login-error"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={() => setPhase("forgot")}
              type="button"
              variant="link"
            >
              Forgot password?
            </Button>
          </div>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
          {error && (
            <p
              id="login-error"
              role="alert"
              className="text-sm font-light text-red-800"
            >
              {error.message}
            </p>
          )}
          <p className="text-sm font-light text-stone-500">
            Don&apos;t have an account yet?{" "}
            <Link
              to={
                returnTo
                  ? `/auth/register?returnTo=${encodeURIComponent(returnTo)}`
                  : "/auth/register"
              }
              className="font-medium hover:underline"
            >
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
};
