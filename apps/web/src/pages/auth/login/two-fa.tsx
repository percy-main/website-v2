import { Button } from "@/components/ui/button.js";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp.js";
import { authClient, useSession } from "@/lib/auth-client.js";
import { resetAuthCaches } from "@/lib/query-client.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FC } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { LoginPhase } from "../login.js";

interface Props {
  setPhase: (phase: LoginPhase) => void;
}

export const TwoFA: FC<Props> = ({ setPhase }) => {
  const [otp, setOtp] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = useSession();

  const signin = useMutation({
    mutationFn: () =>
      authClient.twoFactor.verifyTotp(
        { code: otp },
        {
          async onSuccess() {
            // Session changed - drop all cached data before the new session
            // lands. Invalidation alone kept the previous account's data
            // readable until each refetch returned (#628). This runs here
            // rather than in the mutation's own onSuccess so the cache is
            // empty before we navigate into the members area.
            await resetAuthCaches(queryClient);
            // See EmailPassword: refetch so the session atom is populated
            // before the new route's RequireAuth reads it.
            await refetchSession();
            void navigate(returnTo ?? "/members");
          },
        },
      ),
  });

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    signin.mutate();
  };

  const error = signin.error ?? signin.data?.error;

  return (
    <section>
      <h1 className="text-xl leading-tight font-semibold tracking-tight text-stone-900 md:text-2xl">
        Two-factor Authentication Required
      </h1>
      <form
        className="flex flex-col items-center justify-center gap-y-4 md:gap-y-6"
        onSubmit={handleSubmit}
      >
        <InputOTP maxLength={6} value={otp} onChange={setOtp}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
        <Button type="submit" className="w-full">
          Verify code
        </Button>
        {error && (
          <p role="alert" className="text-sm font-light text-red-800">
            {error.message}
          </p>
        )}
        <Button
          type="button"
          variant="link"
          onClick={() => setPhase("recovery")}
        >
          Stuck? Use a recovery code.
        </Button>
      </form>
    </section>
  );
};
