import { useState } from "react";
import { match } from "ts-pattern";
import type { LoginPhase } from "./login.js";
import { ForgotPassword } from "./login/forgot-password.js";
import { ResetPassword as ResetPasswordForm } from "./login/reset-password.js";

export function Component() {
  const [phase, setPhase] = useState<LoginPhase>("reset");

  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="space-y-4 p-6 sm:p-8 md:space-y-6">
        {match(phase)
          .with("forgot", () => <ForgotPassword />)
          .with("reset", () => <ResetPasswordForm setPhase={setPhase} />)
          .otherwise(() => (
            <ForgotPassword />
          ))}
      </div>
    </div>
  );
}
