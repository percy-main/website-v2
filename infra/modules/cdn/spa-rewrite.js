// CloudFront Function (cloudfront-js-2.0)
// Logic is duplicated from spa-rewrite.handler.js — keep in sync.
// This file is a Terraform template; ${api_base_url} is interpolated at deploy time.

import cf from "cloudfront";

var API_BASE_URL = "${api_base_url}";

// The prerender KeyValueStore holds one key per prerendered public URL
// (kept in step by the prerenderer Lambda). No store associated, or an
// empty store, means pure-SPA behaviour.
var kvsHandle = null;
try {
  kvsHandle = cf.kvs();
} catch (err) {
  kvsHandle = null;
}

async function handler(event) {
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

  // Snapshot objects are reachable only via the extensionless rewrite
  // below; direct hits would serve duplicate content at the wrong URL.
  if (uri.startsWith("/_prerender/")) {
    return { statusCode: 404, statusDescription: "Not Found" };
  }

  // Extensionless URIs are app routes: prerendered documents when the
  // KVS says a snapshot exists (trailing slash normalised so /club/ and
  // /club share one cache entry). A snapshot carries its own OG meta,
  // so it wins over the game OG redirect below; games WITHOUT a
  // snapshot (past seasons, pre-first-render) keep the redirect so
  // link previews never regress. Everything else gets the SPA shell.
  if (!uri.includes(".")) {
    var lookupUri = uri;
    if (lookupUri.length > 1 && lookupUri.endsWith("/")) {
      lookupUri = lookupUri.slice(0, -1);
    }
    // The home page is never a snapshot (the prerenderer only writes
    // content URLs, which always have at least one slug segment).
    if (kvsHandle && lookupUri !== "/") {
      try {
        await kvsHandle.get(lookupUri);
        request.uri = "/_prerender" + lookupUri + ".html";
        return request;
      } catch (err) {
        // Key missing (or KVS error): fall through.
      }
    }

    // Redirect un-snapshotted game pages to the API for OG meta tags
    // (unless returning via bypass param)
    if (API_BASE_URL) {
      var gameMatch = uri.match(/^\/calendar\/game\/(\d+)$/);
      var bypass = qs && qs.og && qs.og.value === "1";
      if (gameMatch && !bypass) {
        // Forward any non-`og` query params so the OG page can reflect
        // them back in the bypass redirect. Without this, deep links
        // like ?bbb=1 (open ball-by-ball modal) get dropped on the
        // round-trip.
        var forwarded = "";
        if (qs) {
          var parts = [];
          for (var k in qs) {
            if (k === "og") continue;
            var entry = qs[k];
            if (entry && typeof entry.value === "string") {
              parts.push(
                encodeURIComponent(k) + "=" + encodeURIComponent(entry.value),
              );
            }
          }
          if (parts.length) forwarded = "?" + parts.join("&");
        }
        return {
          statusCode: 302,
          statusDescription: "Found",
          headers: {
            location: {
              value:
                API_BASE_URL +
                "/api/og/game/" +
                gameMatch[1] +
                "/page" +
                forwarded,
            },
          },
        };
      }
    }

    request.uri = "/index.html";
  }
  return request;
}
