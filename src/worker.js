export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const accept = request.headers.get("accept") || "";
    const ua = request.headers.get("user-agent") || "";
    
    // === 新添加的通用代理功能 ===
    // 处理 /proxy/ 路径的代理请求
    if (url.pathname.startsWith("/proxy/")) {
      return handleUniversalProxy(request, url);
    }
    
    // === 你的原始逻辑开始 ===
    
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
        
        // 创建最终响应
        const finalResponse = new Response(response.body, { status: 200, headers });
        
        // === 只在这里添加缓存存储 ===
        // 使用 ctx.waitUntil 确保不阻塞主响应
        ctx.waitUntil(caches.default.put(request, finalResponse.clone()));
        
        return finalResponse;
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
        const response = await env.ASSETS.fetch(homeRequest);
        
        // === 只在这里添加缓存存储 ===
        ctx.waitUntil(caches.default.put(request, response.clone()));
        
        return response;
      }

      // 2. 调试工具（curl/wget 等）
      if (/curl|wget|httpie|python-requests/i.test(ua)) {
        const response = new Response("api 文件内容示例字符串", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
        
        // === 只在这里添加缓存存储 ===
        ctx.waitUntil(caches.default.put(request, response.clone()));
        
        return response;
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
        
        const finalResponse = new Response(response.body, { status: 200, headers });
        
        // === 只在这里添加缓存存储 ===
        ctx.waitUntil(caches.default.put(request, finalResponse.clone()));
        
        return finalResponse;
      }
      return new Response("api file not found", { status: 404 });
    }

    // 其他路径交给 ASSETS
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      
      // === 可选：为静态资源添加缓存存储 ===
      if (request.method === "GET") {
        const contentType = response.headers.get("content-type") || "";
        // 只缓存成功的静态资源响应
        if (response.status === 200 && (
          contentType.includes("image/") || 
          contentType.includes("font/") ||
          contentType.includes("application/javascript") ||
          contentType.includes("text/css") ||
          contentType.includes("text/html")
        )) {
          ctx.waitUntil(caches.default.put(request, response.clone()));
        }
      }
      
      return response;
    }
    
    return new Response("Not Found", { status: 404 });
  }
};

// === 修复后的通用代理处理函数 ===
async function handleUniversalProxy(request, originalUrl) {
  try {
    // 解析请求路径格式：/proxy/https://example.com/path
    const fullPath = originalUrl.pathname.substring(7); // 去掉 "/proxy/"
    
    if (!fullPath) {
      // 显示代理使用说明
      return showProxyUsage(originalUrl.origin);
    }
    
    // 检查是否有协议前缀
    let targetUrl;
    if (fullPath.startsWith('http://') || fullPath.startsWith('https://')) {
      // 完整URL模式：/proxy/https://example.com/path
      targetUrl = fullPath;
    } else {
      // 简化模式：默认使用HTTPS
      targetUrl = 'https://' + fullPath;
    }
    
    // 添加查询参数
    if (originalUrl.search) {
      const targetUrlObj = new URL(targetUrl);
      originalUrl.searchParams.forEach((value, key) => {
        targetUrlObj.searchParams.append(key, value);
      });
      targetUrl = targetUrlObj.toString();
    }
    
    // 解析目标URL
    const targetUrlObj = new URL(targetUrl);
    
    // 安全检查
    if (isLocalOrInternal(targetUrlObj.hostname)) {
      return new Response('禁止代理到本地或内部网络', { status: 403 });
    }
    
    // 检查协议
    if (targetUrlObj.protocol !== 'https:' && targetUrlObj.protocol !== 'http:') {
      return new Response('只支持HTTP/HTTPS协议', { status: 400 });
    }
    
    // 构建代理请求
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: cleanProxyHeaders(request.headers, targetUrlObj.host),
      body: request.body,
      redirect: 'follow'
    });
    
    // 发送请求
    const response = await fetch(proxyRequest);
    
    // 处理响应
    const contentType = response.headers.get('content-type') || '';
    
    // 如果是API响应（JSON/文本），不进行重写
    if (contentType.includes('application/json') || 
        contentType.includes('text/plain') ||
        originalUrl.pathname.includes('/api/')) {
      
      const headers = new Headers(response.headers);
      setCorsHeaders(headers);
      removeSecurityHeaders(headers);
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    }
    
    // 如果是HTML，进行智能重写
    if (contentType.includes('text/html')) {
      const body = await response.text();
      const rewrittenBody = rewriteHtmlForApi(body, targetUrlObj, originalUrl.origin);
      
      const headers = new Headers(response.headers);
      setCorsHeaders(headers);
      removeSecurityHeaders(headers);
      
      return new Response(rewrittenBody, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    }
    
    // 其他类型（CSS、JS、图片等）
    const headers = new Headers(response.headers);
    setCorsHeaders(headers);
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(`代理错误: ${error.message}`, { 
      status: 500,
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }
}

// === 清理代理请求头 ===
function cleanProxyHeaders(originalHeaders, targetHost) {
  const headers = new Headers(originalHeaders);
  
  // 移除可能泄露代理的信息
  const headersToRemove = [
    'cf-connecting-ip',
    'x-forwarded-for',
    'x-real-ip',
    'cf-ray',
    'cf-ipcountry',
    'cf-visitor',
    'cf-worker',
    'x-forwarded-proto',
    'x-forwarded-host'
  ];
  
  headersToRemove.forEach(header => headers.delete(header));
  
  // 设置正确的Host
  headers.set('Host', targetHost);
  
  // 设置Referer
  headers.set('Referer', `https://${targetHost}/`);
  
  // 添加合理的User-Agent
  if (!headers.has('User-Agent') || headers.get('User-Agent').includes('Cloudflare')) {
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }
  
  return headers;
}

// === 设置CORS头 ===
function setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Expose-Headers', '*');
  headers.set('Access-Control-Max-Age', '86400');
}

// === 移除安全头 ===
function removeSecurityHeaders(headers) {
  const securityHeaders = [
    'content-security-policy',
    'x-frame-options',
    'x-content-type-options',
    'strict-transport-security',
    'x-xss-protection'
  ];
  
  securityHeaders.forEach(header => headers.delete(header));
}

// === 针对API网站的HTML重写 ===
function rewriteHtmlForApi(html, targetUrl, proxyOrigin) {
  const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
  const proxyBase = `${proxyOrigin}/proxy/${targetOrigin}`;
  
  // 重写各种URL
  let rewritten = html;
  
  // 1. 重写链接 (href, src, action)
  rewritten = rewritten.replace(/(href|src|action)=["']([^"']+)["']/gi, (match, attr, url) => {
    const newUrl = convertUrlForApi(url, targetOrigin, proxyBase);
    return `${attr}="${newUrl}"`;
  });
  
  // 2. 重写CSS中的url()
  rewritten = rewritten.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    const newUrl = convertUrlForApi(url, targetOrigin, proxyBase);
    return `url("${newUrl}")`;
  });
  
  // 3. 重写JavaScript fetch/XHR请求（针对API调用）
  rewritten = rewritten.replace(/(fetch|axios\.get|axios\.post|\.open)\s*\(\s*["']([^"']+)["']/gi, (match, method, url) => {
    // 如果是API调用，确保使用代理
    if (url.includes('/api/') || url.startsWith('/api')) {
      const newUrl = convertUrlForApi(url, targetOrigin, proxyBase);
      return `${method}("${newUrl}"`;
    }
    return match;
  });
  
  // 4. 重写相对路径的API调用
  rewritten = rewritten.replace(/"\/api\/([^"]+)"/g, (match, path) => {
    return `"${proxyBase}/api/${path}"`;
  });
  
  // 5. 重写表单的action（针对弹幕API）
  rewritten = rewritten.replace(/action=["'](\/api\/[^"']+)["']/gi, (match, actionPath) => {
    return `action="${proxyBase}${actionPath}"`;
  });
  
  return rewritten;
}

// === URL转换（针对API网站优化） ===
function convertUrlForApi(url, targetOrigin, proxyBase) {
  // 跳过数据URL、JavaScript等
  if (url.startsWith('data:') || 
      url.startsWith('javascript:') || 
      url.startsWith('mailto:') || 
      url.startsWith('tel:') ||
      url.startsWith('#') ||
      url === '') {
    return url;
  }
  
  try {
    // 如果是完整的URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // 检查是否同源
      if (url.startsWith(targetOrigin)) {
        // 同源URL转换为代理URL
        const path = url.substring(targetOrigin.length);
        return `${proxyBase}${path}`;
      }
      return url; // 不同源保持原样
    }
    
    // 协议相对URL
    if (url.startsWith('//')) {
      const fullUrl = `https:${url}`;
      if (fullUrl.startsWith(targetOrigin)) {
        const path = fullUrl.substring(targetOrigin.length);
        return `${proxyBase}${path}`;
      }
      return url;
    }
    
    // 绝对路径
    if (url.startsWith('/')) {
      return `${proxyBase}${url}`;
    }
    
    // 相对路径 - 对于API网站，我们假设相对路径也是同源的
    return `${proxyBase}/${url}`;
    
  } catch (error) {
    console.warn('URL转换失败:', url, error);
    return url;
  }
}

// === 弹幕API专用代理端点（可选） ===
async function handleDanmuProxy(request, originalUrl) {
  const danmuApi = 'https://danmu-api.vercel.app';
  const path = originalUrl.pathname.replace('/danmu-proxy', '');
  
  const targetUrl = `${danmuApi}${path}${originalUrl.search}`;
  
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: cleanProxyHeaders(request.headers, 'danmu-api.vercel.app'),
    body: request.body
  });
  
  const response = await fetch(proxyRequest);
  
  const headers = new Headers(response.headers);
  setCorsHeaders(headers);
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

// === 安全检查 ===
function isLocalOrInternal(hostname) {
  const localHosts = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0'
  ];
  
  return localHosts.some(pattern => hostname === pattern);
}

// === 代理使用说明页面 ===
function showProxyUsage(origin) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>代理服务</title></head><body>
    <h1>代理服务</h1>
    <p>使用格式: <code>${origin}/proxy/https://目标网站</code></p>
    <p>示例:</p>
    <ul>
      <li><a href="${origin}/proxy/https://danmu-api.vercel.app">${origin}/proxy/https://danmu-api.vercel.app</a></li>
      <li><a href="${origin}/proxy/https://danmu-api.vercel.app/api/get">${origin}/proxy/https://danmu-api.vercel.app/api/get</a></li>
    </ul>
    </body></html>`;
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}