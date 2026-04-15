import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
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
  const apiBaseURL = config.API_BASE_URL;

  const ssoPlugin =
    config.SSO_SAML_ENTRY_POINT &&
    config.SSO_SAML_ISSUER &&
    config.SSO_SAML_CERT
      ? sso({
          defaultSSO: [
            {
              providerId: "google-workspace",
              domain: "percymain.org",
              samlConfig: {
                issuer: config.SSO_SAML_ISSUER,
                entryPoint: config.SSO_SAML_ENTRY_POINT,
                cert: config.SSO_SAML_CERT,
                callbackUrl: `${apiBaseURL}/api/auth/sso/saml2/sp/acs/google-workspace`,
                spMetadata: {
                  entityID: `${apiBaseURL}/api/auth/sso/saml2/sp/metadata`,
                },
              },
            },
          ],
          saml: {
            allowIdpInitiated: true,
          },
        })
      : null;

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
      ...(ssoPlugin ? [ssoPlugin] : []),
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
