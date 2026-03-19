import { passkey } from "@better-auth/passkey";
import { ResetPassword, VerifyEmail, type Email } from "@percy-main/email";
import { render } from "@react-email/render";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";
import type { PostgresDialect } from "kysely";
import { createElement } from "react";
import type { Config } from "../../config.ts";

export function createAuth(
  config: Config,
  dialect: PostgresDialect,
  send: (email: Email) => Promise<void>,
) {
  const baseURL = config.BASE_URL;

  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    appName: config.BETTER_AUTH_RP_NAME,
    trustedOrigins: [baseURL, config.DEPLOY_PRIME_URL].filter(
      Boolean,
    ) as string[],
    database: {
      type: "postgres",
      dialect,
    },
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      passkey({
        rpID: config.BETTER_AUTH_RP_ID,
        rpName: config.BETTER_AUTH_RP_NAME,
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
}

export type Auth = ReturnType<typeof createAuth>;
