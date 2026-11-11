// API funtion
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const headers = request.headers
    let body;
    const contentType = request.headers.get('content-type') || '';
    const corsHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, PUT, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };
    
    // =========================
    // 📶 MAIN API
    // =========================
    if (url.pathname.startsWith("/api/")) {
      try {
        let resp = {object: "nothing"};
        // Return res111ponse
        return new Response(JSON.stringify({
          resp
        }), {
          headers: corsHeaders
        })
      } catch (e) {
        console.error("API ERROR:", e?.stack || e);
        // await sendErrorEmail(env, e, `API ${url.pathname}`);
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
        // For SVG files, serve with correct content-type
        const isSvg = url.pathname.endsWith('.svg');
        const contentType = isSvg ? 'image/svg+xml; charset=utf-8' : (assetResponse.headers.get("Content-Type") || "application/octet-stream");
        
        return new Response(assetResponse.body, {
          headers: corsHeaders
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
  }
}
