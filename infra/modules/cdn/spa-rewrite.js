// CloudFront Function (cloudfront-js-2.0)
// Logic is duplicated from spa-rewrite.handler.js — keep in sync.
// This file is a Terraform template; ${api_base_url} is interpolated at deploy time.

var API_BASE_URL = "${api_base_url}";

function handler(event) {
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
  if (API_BASE_URL) {
    var gameMatch = uri.match(/^\/calendar\/game\/(\d+)$/);
    var bypass = qs && qs.og && qs.og.value === "1";
    if (gameMatch && !bypass) {
      return {
        statusCode: 302,
        statusDescription: "Found",
        headers: {
          location: {
            value: API_BASE_URL + "/api/og/game/" + gameMatch[1] + "/page",
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
}
