import { SimpleInput } from "@/components/form/simple-input.js";
import { Button } from "@/components/ui/button.js";
import { authClient } from "@/lib/auth-client.js";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FC } from "react";
import { Link, useNavigate } from "react-router";
import type { LoginPhase } from "../login.js";

interface Props {
  setPhase: (phase: LoginPhase) => void;
}

const GoogleIcon: FC = () => (
  <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
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

  useEffect(() => {
    async function tryPasskeyAutofill() {
      const available =
        await PublicKeyCredential?.isConditionalMediationAvailable?.();
      if (!available) return;

      void authClient.signIn.passkey(
        { autoFill: true },
        {
          onSuccess() {
            void navigate("/members");
          },
        },
      );
    }
    void tryPasskeyAutofill();
  }, [navigate]);

  const signin = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.email({ email, password });
      if (result.error)
        throw new Error(result.error.message ?? "Sign in failed");
      return result.data;
    },
    onSuccess(data) {
      if (data && "twoFactorRedirect" in data) {
        setPhase("2fa");
        return;
      }
      void navigate("/members");
    },
  });

  const googleSignIn = useMutation({
    mutationFn: () =>
      authClient.signIn.social({
        provider: "google",
        callbackURL: "/members",
      }),
  });

  const handleSubmit = useCallback(
    (event: React.SyntheticEvent) => {
      event.preventDefault();
      signin.mutate();
    },
    [signin],
  );

  const error = signin.error ?? googleSignIn.error ?? googleSignIn.data?.error;

  return (
    <section>
      <h1 className="text-xl leading-tight font-bold tracking-tight text-gray-900 md:text-2xl">
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
          <div className="h-px flex-1 bg-gray-300" />
          <span className="px-4 text-sm text-gray-500">or</span>
          <div className="h-px flex-1 bg-gray-300" />
        </div>
        <form className="space-y-4 md:space-y-6" onSubmit={handleSubmit}>
          <SimpleInput
            id="email"
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            autoComplete="email webauthn"
          />
          <SimpleInput
            id="password"
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            autoComplete="current-password webauthn"
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
            <p className="text-sm font-light text-red-800">{error.message}</p>
          )}
          <p className="text-sm font-light text-gray-500">
            Don&apos;t have an account yet?{" "}
            <Link to="/auth/register" className="font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
};
