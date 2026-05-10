import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { ResetPassword, VerifyEmail, type Email } from "@percy-main/email";
import { render } from "@react-email/render";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";
import type { FastifyBaseLogger } from "fastify";
import type { PostgresDialect } from "kysely";
import { createElement } from "react";
import type { Config } from "../../config.ts";

export function createAuth(
  config: Config,
  dialect: PostgresDialect,
  send: (email: Email) => Promise<void>,
  log: FastifyBaseLogger,
) {
  const baseURL = config.BASE_URL;
  const apiBaseURL = config.API_BASE_URL;

  return betterAuth({
    baseURL: apiBaseURL,
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
      ...(config.BETTER_AUTH_API_KEY ? [dash()] : []),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        try {
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
          log.info(
            { event: "auth.email", kind: "reset", userId: user.id },
            "auth_email_sent",
          );
        } catch (err) {
          log.error(
            { event: "auth.email", kind: "reset", userId: user.id, err },
            "auth_email_failed",
          );
          throw err;
        }
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        try {
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
          log.info(
            { event: "auth.email", kind: "verify", userId: user.id },
            "auth_email_sent",
          );
        } catch (err) {
          log.error(
            { event: "auth.email", kind: "verify", userId: user.id, err },
            "auth_email_failed",
          );
          throw err;
        }
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
