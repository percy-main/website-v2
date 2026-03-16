import { useState, type FC } from "react";
import { match } from "ts-pattern";
import { EmailPassword } from "./login/email-password.js";
import { ForgotPassword } from "./login/forgot-password.js";
import { Recovery } from "./login/recovery.js";
import { ResetPassword } from "./login/reset-password.js";
import { TwoFA } from "./login/two-fa.js";

export type LoginPhase = "login" | "2fa" | "recovery" | "forgot" | "reset";

const LoginPage: FC = () => {
  const [phase, setPhase] = useState<LoginPhase>("login");

  return (
    <div className="w-full rounded-lg bg-white shadow-sm sm:max-w-md">
      <div className="space-y-4 p-6 sm:p-8 md:space-y-6">
        {match(phase)
          .with("login", () => <EmailPassword setPhase={setPhase} />)
          .with("2fa", () => <TwoFA setPhase={setPhase} />)
          .with("recovery", () => <Recovery setPhase={setPhase} />)
          .with("forgot", () => <ForgotPassword />)
          .with("reset", () => <ResetPassword setPhase={setPhase} />)
          .exhaustive()}
      </div>
    </div>
  );
};

export function Component() {
  return <LoginPage />;
}
