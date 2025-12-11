export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 首页：显示文件列表
    if (url.pathname === '/') {
      return this.handleFileList(request, env);
    }
    
    // 文件下载页面
    if (url.pathname.startsWith('/download/')) {
      return this.handleFileDownload(request, env, url);
    }
    
    // 提供静态文件
    return env.ASSETS.fetch(request);
  },

  // 生成文件列表页面
  async handleFileList(request, env) {
    try {
      // 尝试获取文件列表（需要自定义实现）
      const html = await this.generateFileListHTML();
      return new Response(html, {
        headers: {
          'content-type': 'text/html;charset=UTF-8',
          'cache-control': 'public, max-age=3600'
        }
      });
    } catch (error) {
      // 如果无法获取列表，显示简单页面
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>文件存储仓库</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
            h1 { color: #333; }
            .directory { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
            .directory a { display: block; padding: 5px 0; color: #0066cc; text-decoration: none; }
            .directory a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>📁 文件存储仓库</h1>
          <p>通过 URL 直接访问文件，格式：<code>https://你的worker.workers.dev/文件夹/文件名</code></p>
          
          <div class="directory">
            <h3>📂 可用目录：</h3>
            <a href="/images">/images - 图片文件</a>
            <a href="/documents">/documents - 文档文件</a>
            <a href="/videos">/videos - 视频文件</a>
          </div>
          
          <div class="directory">
            <h3>🔗 示例链接：</h3>
            <a href="/images/photo1.jpg">/images/photo1.jpg</a>
            <a href="/documents/readme.pdf">/documents/readme.pdf</a>
          </div>
          
          <p><em>提示：要添加文件，只需推送到 GitHub 仓库的 files/ 目录即可。</em></p>
        </body>
        </html>
      `, {
        headers: { 'content-type': 'text/html;charset=UTF-8' }
      });
    }
  },

  // 处理文件下载
  async handleFileDownload(request, env, url) {
    const filePath = url.pathname.replace('/download/', '');
    const response = await env.ASSETS.fetch(new URL(`${request.url.origin}/${filePath}`));
    
    if (response.status === 404) {
      return new Response('文件不存在', { status: 404 });
    }
    
    // 添加下载头
    const headers = new Headers(response.headers);
    const fileName = filePath.split('/').pop();
    headers.set('content-disposition', `attachment; filename="${fileName}"`);
    
    return new Response(response.body, {
      status: response.status,
      headers: headers
    });
  },

  // 生成文件列表 HTML（简单版本）
  async generateFileListHTML() {
    // 注意：Worker Assets 绑定不支持列出文件
    // 这是一个静态列表，需要手动维护
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>文件列表</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background: #f7f9fc; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 10px; margin-bottom: 30px; }
        .file-list { background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .file-item { display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid #eee; }
        .file-item:last-child { border-bottom: none; }
        .file-name { font-size: 16px; color: #333; }
        .file-type { padding: 4px 12px; background: #e9ecef; border-radius: 20px; font-size: 12px; color: #666; }
        .download-btn { padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; text-decoration: none; }
        .directory { background: #e3f2fd; padding: 10px 15px; border-radius: 5px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📦 文件存储仓库</h1>
          <p>总空间：免费无限（GitHub + Cloudflare）</p>
        </div>
        
        <div class="file-list">
          <h2>🗂️ 文件目录</h2>
          
          <div class="directory">
            <h3>🖼️ 图片文件 (/images/)</h3>
            <!-- 手动添加文件列表 -->
            <div class="file-item">
              <span class="file-name">example-image.jpg</span>
              <span class="file-type">JPEG</span>
              <a href="/images/example-image.jpg" class="download-btn">下载</a>
            </div>
          </div>
          
          <div class="directory">
            <h3>📄 文档文件 (/documents/)</h3>
            <!-- 手动添加文件列表 -->
            <div class="file-item">
              <span class="file-name">readme.pdf</span>
              <span class="file-type">PDF</span>
              <a href="/documents/readme.pdf" class="download-btn">下载</a>
            </div>
          </div>
          
          <div class="directory">
            <h3>🎥 视频文件 (/videos/)</h3>
            <p><em>暂无文件，添加视频到 files/videos/ 目录</em></p>
          </div>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: white; border-radius: 10px;">
          <h3>📋 使用方法</h3>
          <ol>
            <li>将文件放入相应的目录（images/, documents/, videos/）</li>
            <li>提交并推送到 GitHub</li>
            <li>Cloudflare 会自动部署</li>
            <li>通过 URL 访问：<code>https://你的worker.workers.dev/目录/文件名</code></li>
          </ol>
        </div>
      </div>
    </body>
    </html>
    `;
  }
};
