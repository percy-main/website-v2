import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import type { DB } from "@percy-main/db";
import { ResetPassword, VerifyEmail, type Email } from "@percy-main/email";
import { ac, roles } from "@percy-main/shared/auth/permissions";
import { render } from "@react-email/render";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";
import type { FastifyBaseLogger } from "fastify";
import { type Kysely, type PostgresDialect } from "kysely";
import { createElement } from "react";
import type { Config } from "../../config.ts";

export function createAuth(
  config: Config,
  dialect: PostgresDialect,
  db: Kysely<DB>,
  send: (email: Email) => Promise<void>,
  log: FastifyBaseLogger,
) {
  const baseURL = config.BASE_URL;
  const apiBaseURL = config.API_BASE_URL;
  const isProduction = config.NODE_ENV === "production";

  return betterAuth({
    baseURL: apiBaseURL,
    basePath: "/api/auth",
    appName: config.BETTER_AUTH_RP_NAME,
    // Every origin we'd accept a cross-origin request from. The matchday
    // app at matchday.percymain.org needs to be listed explicitly even
    // though the cookie is scoped to .percymain.org — better-auth
    // validates Origin against this list before issuing tokens.
    trustedOrigins: [
      baseURL,
      config.MATCHDAY_URL,
      config.WWW_URL,
      config.DEPLOY_PRIME_URL,
    ].filter(Boolean) as string[],
    advanced: {
      // Cross-subdomain session cookie. Only enabled when the operator
      // has set COOKIE_DOMAIN — that way local single-origin dev keeps
      // working unchanged. Production sets COOKIE_DOMAIN=.percymain.org.
      ...(config.COOKIE_DOMAIN
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: config.COOKIE_DOMAIN,
            },
          }
        : {}),
      useSecureCookies: isProduction,
    },
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
      admin({
        ac,
        roles,
        adminRoles: ["admin", "superadmin"],
      }),
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
    databaseHooks: {
      user: {
        create: {
          // Every new user gets a paired `member` row keyed by email. This
          // turns the legacy "members are only created when an admin
          // creates one, or when a junior signs up for the first time"
          // model into a 1:1 link from sign-up onwards, so flows like
          // financial relief that look up the caller's member record
          // don't have to handle a brand-new user with no member row.
          //
          // Idempotent: if a member row already exists for this email
          // (e.g. a junior parent created one ahead of registering, or
          // the admin pre-created the member), we leave it alone.
          after: async (user) => {
            try {
              const existing = await db
                .selectFrom("member")
                .where("email", "=", user.email)
                .select("id")
                .executeTakeFirst();
              if (existing) return;
              await db
                .insertInto("member")
                .values({
                  id: crypto.randomUUID(),
                  email: user.email,
                  // Mirror the user's display name into the member row
                  // so the relief form's "Who is this for?" shows the
                  // right thing on day 0. The Details tab can still
                  // edit it later.
                  name: user.name ?? null,
                })
                .execute();
            } catch (err) {
              log.error(
                { event: "auth.member-link", err, userId: user.id },
                "auth_member_link_failed",
              );
            }
          },
        },
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
