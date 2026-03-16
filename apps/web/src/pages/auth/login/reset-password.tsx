import { SimpleInput } from "@/components/form/simple-input.js";
import { Button } from "@/components/ui/button.js";
import { useSearchParam } from "@/hooks/use-search-param.js";
import { authClient } from "@/lib/auth-client.js";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState, type FC } from "react";
import { z } from "zod";
import type { LoginPhase } from "../login.js";

interface Props {
  setPhase: (phase: LoginPhase) => void;
}

export const ResetPassword: FC<Props> = ({ setPhase }) => {
  const [newPassword, setNewPassword] = useState("");

  const token = useSearchParam({
    decode: false,
    param: "token",
    schema: z.string().optional(),
  });

  const paramError = useSearchParam({
    decode: false,
    param: "error",
    schema: z.string().optional(),
  });

  const resetPassword = useMutation({
    mutationFn: () =>
      authClient.resetPassword(
        { newPassword, token },
        {
          onSuccess: () => {
            setPhase("login");
          },
        },
      ),
  });

  const handleSubmit = useCallback(
    (event: React.SyntheticEvent) => {
      event.preventDefault();
      resetPassword.mutate();
    },
    [resetPassword],
  );

  const error = resetPassword.error ?? resetPassword.data?.error;

  if (paramError) {
    return (
      <section>
        <h1 className="text-xl leading-tight font-bold tracking-tight text-gray-900 md:text-2xl">
          Something went wrong
        </h1>
        <p>We can&apos;t reset your password right now.</p>
        <Button
          onClick={() => setPhase("forgot")}
          type="button"
          variant="link"
        >
          Try again
        </Button>
      </section>
    );
  }

  if (!token) {
    return (
      <section>
        <h1 className="text-xl leading-tight font-bold tracking-tight text-gray-900 md:text-2xl">
          How did you get here?
        </h1>
        <p>You sneaky devil.</p>
        <p>Let&apos;s try resetting your password again.</p>
        <Button
          onClick={() => setPhase("forgot")}
          type="button"
          variant="link"
        >
          Try again
        </Button>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-xl leading-tight font-bold tracking-tight text-gray-900 md:text-2xl">
        Set your new password
      </h1>
      <form
        className="flex flex-col items-center justify-center space-y-4 md:space-y-6"
        onSubmit={handleSubmit}
      >
        <SimpleInput
          type="password"
          id="new-password"
          label="New Password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.currentTarget.value)}
        />
        <Button type="submit" className="w-full">
          Submit
        </Button>
        {error && (
          <p className="text-sm font-light text-red-800">{error.message}</p>
        )}
      </form>
    </section>
  );
};
