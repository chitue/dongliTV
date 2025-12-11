export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const accept = request.headers.get("accept") || "";
    const ua = request.headers.get("user-agent") || "";

    // 根目录访问
    if (url.pathname === "/" || url.pathname === "/home.html") {
      // 1. 浏览器访问主页
      if (ua.includes("Mozilla") && accept.includes("text/html")) {
        return new Response("<h1>欢迎访问主页</h1>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      // 2. 调试工具（curl/wget 等）
      if (/curl|wget|httpie|python-requests/i.test(ua)) {
        return new Response("api.enc 文件内容示例字符串", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // 3. 其他情况默认当成 API 调用
      if (!env.ASSETS) {
        return new Response("ASSETS binding not configured", { status: 500 });
      }

      const apiEncRequest = new Request(`${url.origin}/api`);
      const response = await env.ASSETS.fetch(apiEncRequest);

      if (response.status === 200) {
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "application/octet-stream");
        headers.set("Content-Disposition", 'attachment; filename="api.enc"');
        return new Response(response.body, { status: 200, headers });
      }

      return new Response("api.enc file not found", { status: 404 });
    }

    // 其他路径交给 ASSETS
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
