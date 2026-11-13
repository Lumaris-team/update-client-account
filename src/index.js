import { updateWorkers } from "./worker-updater.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const corsHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/update-workers") {
      if (method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { ...corsHeaders, Allow: "POST" },
        });
      }

      try {
        const results = await updateWorkers(env.CONFIGURATION, {
          token: env.ACCESS_TOKEN,
          githubToken: env.GITHUB_TOKEN,
          accountId: env.CLOUDFLARE_ACCOUNT_ID,
        });
        return new Response(JSON.stringify({ results }), { headers: corsHeaders });
      } catch (error) {
        console.error("WORKER UPDATE ERROR:", error?.stack || error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    // =========================
    // 📶 MAIN API
    // =========================
    if (url.pathname.startsWith("/api/")) {
      try {
        const resp = { object: "nothing" };
        return new Response(JSON.stringify({
          resp
        }), {
          headers: corsHeaders
        })
      } catch (e) {
        console.error("API ERROR:", e?.stack || e);
        return new Response(JSON.stringify({
          error: e?.message,
        }), {
          status: 500,
          headers: corsHeaders
        });
      }
    }
    // =========================
    // 🌐 SITE (Cloudflare assets)
    // =========================
    // Add CORS headers for assets to allow browser loading
    if (url.pathname.startsWith("/assets/") && method==="GET") {
      const assetResponse = await env.ASSETS.fetch(request);

      if (assetResponse.ok) {
        return new Response(assetResponse.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": assetResponse.headers.get("Content-Type") || "application/octet-stream",
          }
        });
      }
      return assetResponse;
    }
    // Pages
    if (
      url.pathname === "/" ||
      url.pathname === ""
    ) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/pages/home/index.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request)
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      updateWorkers(env.CONFIGURATION, {
        token: env.ACCESS_TOKEN,
        githubToken: env.GITHUB_TOKEN,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
      }).catch((error) => {
        console.error("SCHEDULED WORKER UPDATE ERROR:", error?.stack || error);
        throw error;
      })
    );
  },
};
