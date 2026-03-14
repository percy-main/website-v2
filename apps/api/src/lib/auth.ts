import { createElement } from "react";
import { dialect } from "@percy-main/db";
import { send, VerifyEmail, ResetPassword } from "@percy-main/email";
import { passkey } from "@better-auth/passkey";
import { render } from "@react-email/render";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";

const baseURL = process.env.BASE_URL ?? "http://localhost:5173";

export const auth = betterAuth({
  appName: process.env.BETTER_AUTH_RP_NAME ?? "Percy Main CSC",
  trustedOrigins: [
    baseURL,
    process.env.DEPLOY_PRIME_URL,
  ].filter(Boolean) as string[],
  database: {
    type: "postgres",
    dialect,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    passkey({
      rpID: process.env.BETTER_AUTH_RP_ID ?? "localhost",
      rpName: process.env.BETTER_AUTH_RP_NAME ?? "Percy Main CSC",
    }),
    twoFactor(),
    admin(),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await send({
        to: user.email,
        subject: ResetPassword.subject,
        html: await render(
          createElement(ResetPassword.component, {
            url,
            imageBaseUrl: `${baseURL}/images`,
            name: user.name,
          }),
          { pretty: true },
        ),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await send({
        to: user.email,
        subject: VerifyEmail.subject,
        html: await render(
          createElement(VerifyEmail.component, {
            url,
            imageBaseUrl: `${baseURL}/images`,
            name: user.name,
          }),
          { pretty: true },
        ),
      });
    },
  },
});
