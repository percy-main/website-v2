import { SimpleInput } from "@/components/form/simple-input.js";
import { Button } from "@/components/ui/button.js";
import { authClient } from "@/lib/auth-client.js";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState, type FC } from "react";
import { match, P } from "ts-pattern";

export const ForgotPassword: FC = () => {
  const [email, setEmail] = useState("");

  const requestReset = useMutation({
    mutationFn: () =>
      authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/auth/reset-password`,
      }),
  });

  const handleSubmit = useCallback(
    (event: React.SyntheticEvent) => {
      event.preventDefault();
      requestReset.mutate();
    },
    [requestReset],
  );

  const error = requestReset.error ?? requestReset.data?.error;

  return (
    <section>
      <h1 className="text-xl leading-tight font-semibold tracking-tight text-stone-900 md:text-2xl">
        Forgotten your password?
      </h1>
      {match(requestReset)
        .with({ data: { data: P.not(P.nullish) } }, () => (
          <p>
            We&apos;ve sent you an email with a link to reset your password.
          </p>
        ))
        .otherwise(() => (
          <form
            className="flex flex-col items-center justify-center gap-y-4 md:gap-y-6"
            onSubmit={handleSubmit}
          >
            <p>
              Enter your email and we&apos;ll send you a link to reset your
              password.
            </p>
            <SimpleInput
              type="email"
              id="email-forgotten"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Button type="submit" className="w-full">
              Submit
            </Button>
            {error && (
              <p className="text-sm font-light text-red-800">{error.message}</p>
            )}
          </form>
        ))}
    </section>
  );
};
