import { Button } from "@/components/ui/button.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client.js";
import { authClient } from "@/lib/auth-client.js";
import { useAuthedQuery } from "@/lib/authed-query.js";
import { useMutation } from "@tanstack/react-query";
import { useState, type FC } from "react";
import { useSearchParams } from "react-router";

/**
 * MCP OAuth consent screen (ADR 062). The mcp() plugin's `/oauth2/authorize`
 * redirects here with client_id/scope (and, for OIDC claims requests,
 * `claims`) query params — NOT an authorization code; despite what
 * @better-auth/oauth-provider's own doc comment on `consentPage` says, the
 * installed 1.7.4 behavior mints the code only once consent is submitted,
 * from the full received query string (verified against a live run, not
 * just the docs). So accepting or denying re-posts the entire query string
 * as `oauth_query` to /oauth2/consent, which responds with
 * `{ redirect: boolean, url: string }` (also undocumented in its own
 * OpenAPI metadata, which claims `redirect_uri` — `url` is what it actually
 * returns) — `url` carries the authorization code (or an error) for the
 * client's redirect_uri. We navigate the browser there directly; this has
 * to be a real navigation, not a fetch, to hand control back to the client
 * application (Claude Code, Claude Desktop, etc).
 */
const ConsentPage: FC = () => {
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get("client_id");
  const scope = searchParams.get("scope");
  const oauthQuery = searchParams.toString();
  const scopes = scope?.split(" ").filter(Boolean) ?? [];

  const [submitError, setSubmitError] = useState<string | null>(null);

  const clientQuery = useAuthedQuery({
    queryKey: ["mcp", "oauth-client", clientId],
    queryFn: () =>
      callApi(
        api.GET("/api/mcp/oauth-client/{clientId}", {
          params: { path: { clientId: clientId ?? "" } },
        }),
      ),
    enabled: !!clientId,
  });

  const respond = useMutation({
    mutationFn: async (accept: boolean) => {
      const { data, error } = await authClient.$fetch<{
        redirect: boolean;
        url: string;
      }>("/oauth2/consent", {
        method: "POST",
        body: { accept, oauth_query: oauthQuery },
      });
      if (error || !data) {
        throw new Error(error?.message ?? "Consent request failed");
      }
      return data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error: Error) => {
      setSubmitError(error.message);
    },
  });

  if (!clientId) {
    return (
      <div className="w-full rounded-lg bg-white p-6 shadow-sm sm:max-w-md sm:p-8">
        <p className="text-body text-sm">
          This page needs to be reached from an MCP client's sign-in flow —
          there's nothing to authorize here on its own.
        </p>
      </div>
    );
  }

  const clientName = clientQuery.data?.name ?? clientId;

  return (
    <div className="w-full space-y-4 rounded-lg bg-white p-6 shadow-sm sm:max-w-md sm:space-y-6 sm:p-8">
      <div>
        <h1 className="text-dark text-lg font-semibold">
          {clientName} wants to access your Percy Main account
        </h1>
        {clientQuery.data?.uri && (
          <p className="text-body/70 mt-1 text-sm">{clientQuery.data.uri}</p>
        )}
      </div>

      {scopes.length > 0 && (
        <ul className="text-body list-inside list-disc text-sm">
          {scopes.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}

      {submitError && (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          className="flex-1"
          disabled={respond.isPending}
          onClick={() => respond.mutate(true)}
        >
          Allow
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          disabled={respond.isPending}
          onClick={() => respond.mutate(false)}
        >
          Deny
        </Button>
      </div>
    </div>
  );
};

export function Component() {
  useDocumentMeta("Authorize access");
  return <ConsentPage />;
}
