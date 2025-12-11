export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const accept = request.headers.get("accept") || "";
    const ua = request.headers.get("user-agent") || "";

    // 特殊处理 /api 路径：始终返回文件下载
    if (url.pathname === "/api") {
      if (!env.ASSETS) {
        return new Response("ASSETS binding not configured", { status: 500 });
      }
      const response = await env.ASSETS.fetch(request);
      if (response.status === 200) {
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Content-Disposition", 'attachment; filename="api"');
        return new Response(response.body, { status: 200, headers });
      }
      return new Response("api file not found", { status: 404 });
    }

    // 根目录或 home.html 访问
    if (url.pathname === "/" || url.pathname === "/home.html") {
      // 1. 浏览器访问：返回真正的 home.html 文件
      if (ua.includes("Mozilla") && accept.includes("text/html")) {
        if (!env.ASSETS) {
          return new Response("ASSETS binding not configured", { status: 500 });
        }
        const homeRequest = new Request(`${url.origin}/home.html`);
        return await env.ASSETS.fetch(homeRequest);
      }

      // 2. 调试工具（curl/wget 等）
      if (/curl|wget|httpie|python-requests/i.test(ua)) {
        return new Response("api 文件内容示例字符串", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // 3. 其他情况默认当成 API 调用 → 返回 api 文件下载
      if (!env.ASSETS) {
        return new Response("ASSETS binding not configured", { status: 500 });
      }
      const apiRequest = new Request(`${url.origin}/api`);
      const response = await env.ASSETS.fetch(apiRequest);

      if (response.status === 200) {
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Content-Disposition", 'attachment; filename="api"');
        return new Response(response.body, { status: 200, headers });
      }
      return new Response("api file not found", { status: 404 });
    }

    // 其他路径交给 ASSETS
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};
