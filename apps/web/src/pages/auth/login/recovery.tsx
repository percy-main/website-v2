import { SimpleInput } from "@/components/form/simple-input.js";
import { Button } from "@/components/ui/button.js";
import { authClient } from "@/lib/auth-client.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FC } from "react";
import { useNavigate } from "react-router";
import type { LoginPhase } from "../login.js";

interface Props {
  setPhase: (phase: LoginPhase) => void;
}

export const Recovery: FC<Props> = ({ setPhase }) => {
  const [recoveryCode, setRecoveryCode] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const verifyBackupCode = useMutation({
    mutationFn: () =>
      authClient.twoFactor.verifyBackupCode(
        { code: recoveryCode },
        {
          onSuccess() {
            void navigate("/members");
          },
        },
      ),
    onSuccess: () => {
      // Session changed — drop all cached data so member-scoped queries refetch.
      void queryClient.invalidateQueries();
    },
  });

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    verifyBackupCode.mutate();
  };

  const error = verifyBackupCode.error ?? verifyBackupCode.data?.error;

  return (
    <section>
      <h1 className="text-xl leading-tight font-semibold tracking-tight text-stone-900 md:text-2xl">
        Use A Recovery Code
      </h1>
      <form
        className="flex flex-col items-center justify-center gap-y-4 md:gap-y-6"
        onSubmit={handleSubmit}
      >
        <SimpleInput
          type="text"
          id="recovery"
          label="Recovery Code"
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.currentTarget.value)}
        />
        <Button type="submit" className="w-full">
          Use recovery code
        </Button>
        {error && (
          <p className="text-sm font-light text-red-800">{error.message}</p>
        )}
        <Button type="button" variant="link" onClick={() => setPhase("2fa")}>
          Back to 2FA
        </Button>
      </form>
    </section>
  );
};
