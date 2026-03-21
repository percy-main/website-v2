/**
 * CloudFront Function handler — SPA rewrite + OG redirect.
 *
 * This module exports the handler for testing. The actual CF function
 * source (spa-rewrite.js) is a Terraform template that inlines the
 * API_BASE_URL variable. Both files must stay in sync.
 *
 * @param {string} apiBaseUrl — injected at deploy time via Terraform templatefile()
 */
export function createHandler(apiBaseUrl) {
  return function handler(event) {
    var request = event.request;
    var host = request.headers.host && request.headers.host.value;

    // Redirect apex to www
    if (host === "percymain.org") {
      return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: {
          location: { value: "https://www.percymain.org" + request.uri },
        },
      };
    }

    // Redirect kit.percymain.org to kit shop
    if (host === "kit.percymain.org") {
      return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: {
          location: {
            value: "https://vx-3.com/collections/percy-main-cricket-club",
          },
        },
      };
    }

    var uri = request.uri;
    var qs = request.querystring;

    // Redirect game pages to API for OG meta tags (unless returning via bypass param)
    if (apiBaseUrl) {
      var gameMatch = uri.match(/^\/games\/(\d+)$/);
      var bypass = qs && qs.og && qs.og.value === "1";
      if (gameMatch && !bypass) {
        return {
          statusCode: 302,
          statusDescription: "Found",
          headers: {
            location: {
              value: apiBaseUrl + "/api/og/game/" + gameMatch[1] + "/page",
            },
          },
        };
      }
    }

    // If URI has no file extension, rewrite to /index.html for SPA routing
    if (!uri.includes(".")) {
      request.uri = "/index.html";
    }
    return request;
  };
}
