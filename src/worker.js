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

// === 通用代理处理函数 ===
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
    
    // 安全检查
    const targetUrlObj = new URL(targetUrl);
    
    // 阻止代理到本地或内部网络
    if (isLocalOrInternal(targetUrlObj.hostname)) {
      return new Response('禁止代理到本地或内部网络', { status: 403 });
    }
    
    // 检查协议
    if (targetUrlObj.protocol !== 'https:' && targetUrlObj.protocol !== 'http:') {
      return new Response('只支持HTTP/HTTPS协议', { status: 400 });
    }
    
    // 构建代理请求头
    const proxyHeaders = new Headers(request.headers);
    
    // 移除敏感头信息
    const headersToRemove = [
      'cf-connecting-ip',
      'x-forwarded-for',
      'x-real-ip',
      'cf-ray',
      'cf-ipcountry',
      'cf-visitor'
    ];
    
    headersToRemove.forEach(header => proxyHeaders.delete(header));
    
    // 设置正确的Host
    proxyHeaders.set('Host', targetUrlObj.host);
    
    // 设置Referer
    proxyHeaders.set('Referer', targetUrl);
    
    // 添加User-Agent（可选）
    if (!proxyHeaders.has('User-Agent')) {
      proxyHeaders.set('User-Agent', 'Mozilla/5.0 (compatible; Cloudflare-Proxy/1.0)');
    }
    
    // 构建代理请求
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'follow',
      // Cloudflare Workers 可能需要这个设置
      cf: {
        // 禁用缓存，避免缓存代理结果
        cacheEverything: false,
        cacheTtl: 0
      }
    });
    
    // 发送请求
    const response = await fetch(proxyRequest);
    
    // 处理响应
    const modifiedHeaders = new Headers(response.headers);
    
    // 设置CORS头
    modifiedHeaders.set('Access-Control-Allow-Origin', '*');
    modifiedHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    modifiedHeaders.set('Access-Control-Allow-Headers', '*');
    modifiedHeaders.set('Access-Control-Expose-Headers', '*');
    
    // 移除或修改安全头
    modifiedHeaders.delete('content-security-policy');
    modifiedHeaders.delete('x-frame-options');
    modifiedHeaders.delete('x-content-type-options');
    
    // 修改缓存控制（可选）
    modifiedHeaders.set('Cache-Control', 'no-store, max-age=0');
    
    // 添加代理信息头
    modifiedHeaders.set('X-Proxy-Server', 'Cloudflare-Worker-Proxy');
    modifiedHeaders.set('X-Proxied-URL', targetUrl);
    
    // 处理重定向
    if ([301, 302, 303, 307, 308].includes(response.status) && modifiedHeaders.has('location')) {
      const location = modifiedHeaders.get('location');
      if (location.startsWith('http')) {
        // 将重定向地址也转换为代理地址
        const proxyRedirect = `${originalUrl.origin}/proxy/${location}`;
        modifiedHeaders.set('location', proxyRedirect);
      } else if (location.startsWith('/')) {
        // 相对路径重定向
        const baseUrl = `${targetUrlObj.protocol}//${targetUrlObj.host}`;
        const absoluteUrl = new URL(location, baseUrl).toString();
        const proxyRedirect = `${originalUrl.origin}/proxy/${absoluteUrl}`;
        modifiedHeaders.set('location', proxyRedirect);
      }
    }
    
    // 处理HTML内容重写
    const contentType = modifiedHeaders.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const body = await response.text();
      const proxyBase = `${originalUrl.origin}/proxy/${targetUrlObj.protocol}//${targetUrlObj.host}`;
      const rewrittenBody = rewriteAllUrls(body, targetUrlObj, proxyBase);
      
      return new Response(rewrittenBody, {
        status: response.status,
        statusText: response.statusText,
        headers: modifiedHeaders
      });
    }
    
    // 处理CSS内容重写
    if (contentType.includes('text/css')) {
      const body = await response.text();
      const proxyBase = `${originalUrl.origin}/proxy/${targetUrlObj.protocol}//${targetUrlObj.host}`;
      const rewrittenBody = rewriteCssUrls(body, targetUrlObj, proxyBase);
      
      return new Response(rewrittenBody, {
        status: response.status,
        statusText: response.statusText,
        headers: modifiedHeaders
      });
    }
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: modifiedHeaders
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

// === 安全检查 ===
function isLocalOrInternal(hostname) {
  const localHosts = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '192.168.',
    '10.',
    '172.16.',
    '172.17.',
    '172.18.',
    '172.19.',
    '172.20.',
    '172.21.',
    '172.22.',
    '172.23.',
    '172.24.',
    '172.25.',
    '172.26.',
    '172.27.',
    '172.28.',
    '172.29.',
    '172.30.',
    '172.31.'
  ];
  
  return localHosts.some(pattern => hostname === pattern || hostname.startsWith(pattern));
}

// === URL重写函数 ===
function rewriteAllUrls(content, originalUrl, proxyBase) {
  // 重写各种URL属性
  const urlAttributes = [
    'href', 'src', 'action', 'data', 'poster',
    'srcset', 'cite', 'background', 'profile',
    'formaction', 'icon', 'manifest', 'archive'
  ];
  
  let rewritten = content;
  
  // 重写普通属性
  urlAttributes.forEach(attr => {
    const regex = new RegExp(`${attr}=["']([^"']+)["']`, 'gi');
    rewritten = rewritten.replace(regex, (match, url) => {
      const newUrl = convertToProxyUrl(url, originalUrl, proxyBase);
      return `${attr}="${newUrl}"`;
    });
  });
  
  // 重写CSS中的url()
  rewritten = rewritten.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    const newUrl = convertToProxyUrl(url, originalUrl, proxyBase);
    return `url("${newUrl}")`;
  });
  
  // 重写JavaScript中的fetch/XHR请求（简单处理）
  rewritten = rewritten.replace(/(fetch|\.open)\s*\(\s*["']([^"']+)["']/gi, (match, method, url) => {
    const newUrl = convertToProxyUrl(url, originalUrl, proxyBase);
    return `${method}("${newUrl}"`;
  });
  
  // 重写meta refresh
  rewritten = rewritten.replace(/content=["']\d+;\s*url=([^"']+)["']/gi, (match, url) => {
    const newUrl = convertToProxyUrl(url, originalUrl, proxyBase);
    return `content="0; url=${newUrl}"`;
  });
  
  return rewritten;
}

// === CSS URL重写 ===
function rewriteCssUrls(content, originalUrl, proxyBase) {
  return content.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    const newUrl = convertToProxyUrl(url, originalUrl, proxyBase);
    return `url("${newUrl}")`;
  });
}

// === URL转换函数 ===
function convertToProxyUrl(url, originalUrl, proxyBase) {
  // 跳过数据URL、锚点、JavaScript等
  if (
    url.startsWith('data:') ||
    url.startsWith('javascript:') ||
    url.startsWith('mailto:') ||
    url.startsWith('tel:') ||
    url.startsWith('#') ||
    url.startsWith('?') ||
    url === ''
  ) {
    return url;
  }
  
  try {
    let absoluteUrl;
    
    if (url.startsWith('//')) {
      // 协议相对URL
      absoluteUrl = originalUrl.protocol + url;
    } else if (url.startsWith('/')) {
      // 绝对路径
      absoluteUrl = `${originalUrl.protocol}//${originalUrl.host}${url}`;
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      // 完整URL
      absoluteUrl = url;
    } else {
      // 相对路径
      const base = `${originalUrl.protocol}//${originalUrl.host}${originalUrl.pathname}`;
      const baseUrlObj = new URL(base);
      absoluteUrl = new URL(url, baseUrlObj).toString();
    }
    
    // 转换为代理URL
    return `${proxyBase}${absoluteUrl.substring(originalUrl.protocol.length + 2 + originalUrl.host.length)}`;
    
  } catch (error) {
    // 如果URL解析失败，返回原始URL
    return url;
  }
}

// === 代理使用说明页面 ===
function showProxyUsage(origin) {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>通用网页代理</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        h1 {
            color: #4a5568;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 10px;
        }
        .card {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        code {
            background: #edf2f7;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 0.9em;
        }
        pre {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
        }
        .example {
            color: #718096;
            font-size: 0.9em;
        }
        a {
            color: #4299e1;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .warning {
            background: #fff5f5;
            border: 1px solid #fed7d7;
            color: #c53030;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <h1>🌐 通用网页代理</h1>
    
    <div class="card">
        <h2>使用方法</h2>
        <p>在URL后面加上要访问的网站地址：</p>
        
        <h3>完整URL模式：</h3>
        <code>${origin}/proxy/https://example.com/path</code>
        
        <h3>简化模式（自动添加https://）：</h3>
        <code>${origin}/proxy/example.com/path</code>
        
        <p class="example">例如：</p>
        <ul>
            <li><a href="${origin}/proxy/https://dmapi-black.vercel.app" target="_blank">${origin}/proxy/https://dmapi-black.vercel.app</a></li>
            <li><a href="${origin}/proxy/example.com" target="_blank">${origin}/proxy/example.com</a></li>
            <li><a href="${origin}/proxy/github.com" target="_blank">${origin}/proxy/github.com</a></li>
        </ul>
    </div>
    
    <div class="warning">
        <strong>⚠️ 注意事项：</strong>
        <ul>
            <li>只支持HTTP/HTTPS网站</li>
            <li>禁止代理本地或内部网络</li>
            <li>某些网站可能无法正常显示（如需要JavaScript的复杂应用）</li>
            <li>请遵守目标网站的使用条款</li>
            <li>不要传输敏感信息</li>
        </ul>
    </div>
    
    <div class="card">
        <h2>API使用示例</h2>
        <h3>cURL：</h3>
        <pre>curl "${origin}/proxy/https://api.example.com/data"</pre>
        
        <h3>JavaScript Fetch：</h3>
        <pre>fetch('${origin}/proxy/https://api.example.com/data')
  .then(response => response.json())
  .then(data => console.log(data))</pre>
    </div>
    
    <div class="card">
        <h2>功能特点</h2>
        <ul>
            <li>✅ 自动重写页面内的链接和资源</li>
            <li>✅ 支持CORS跨域访问</li>
            <li>✅ 自动处理重定向</li>
            <li>✅ 支持查询参数</li>
            <li>✅ 基本的URL安全过滤</li>
            <li>✅ 支持CSS和JavaScript资源重写</li>
        </ul>
    </div>
    
    <footer>
        <p>Powered by Cloudflare Workers | 这是一个通用代理工具，请负责任地使用</p>
    </footer>
</body>
</html>`;
  
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}