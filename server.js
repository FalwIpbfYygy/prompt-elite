/**
 * Prompt Elite —— 零依赖本地服务
 * 职责：
 *   1. 静态托管 public/
 *   2. 提示词 JSON 文件存储（data/prompts.json）CRUD + 导入/导出
 *   3. /api/chat 把 LLM 调用做成流式代理（避免浏览器 CORS，密钥仅留服务端）
 *
 * 运行：node server.js   （默认端口 8787，可用 PORT 环境变量覆盖）
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'prompts.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const CONFIG_EXAMPLE = path.join(ROOT, 'config.example.json');
const DOTENV_FILE = path.join(ROOT, '.env');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

// ---------- 加载 .env（零依赖，仅在变量未设置时注入）----------
function loadDotEnv() {
  if (!fs.existsSync(DOTENV_FILE)) return;
  const text = fs.readFileSync(DOTENV_FILE, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv();

// ---------- 配置加载 ----------
// 优先级：.env / 环境变量 > config.json > config.example.json
let CONFIG = {};
try {
  const cfgPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : CONFIG_EXAMPLE;
  CONFIG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  console.error('[config] 读取配置失败：', e.message);
  CONFIG = {};
}
// 环境变量 / .env 优先覆盖密钥与端点
CONFIG.apiKey = process.env.DASHSCOPE_API_KEY || CONFIG.apiKey || '';
CONFIG.privateBaseUrl = process.env.PRIVATE_BASE_URL || CONFIG.privateBaseUrl || '';
CONFIG.commonBaseUrl = process.env.COMMON_BASE_URL || CONFIG.commonBaseUrl || '';
CONFIG.defaultModel = process.env.DEFAULT_MODEL || CONFIG.defaultModel || 'deepseek-v4.1-flash';
CONFIG.timeoutMs = process.env.TIMEOUT_MS ? parseInt(process.env.TIMEOUT_MS, 10) : (CONFIG.timeoutMs || 120000);

// ---------- 数据库 ----------
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');
}
function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error('[db] 读取失败，重置为空：', e.message);
    return [];
  }
}
function writeDb(arr) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(arr, null, 2), 'utf8');
}
function genId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ---------- 工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // 防目录穿越
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- LLM 流式代理 ----------
function proxyChat(req, res, body) {
  const {
    messages, model, temperature, max_tokens,
    baseUrl, basePreset, apiKey, stream = true
  } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: 'messages 不能为空' });
    return;
  }

  const key = apiKey || CONFIG.apiKey;
  // 解析 base：自定义优先，其次按预设名映射到服务端配置
  let base;
  if (baseUrl) base = baseUrl;
  else if (basePreset === 'common') base = CONFIG.commonBaseUrl;
  else base = CONFIG.privateBaseUrl;
  if (!base) base = CONFIG.commonBaseUrl;
  if (!key) {
    sendJson(res, 500, { error: '服务端未配置 apiKey，请在 config.json 或环境变量 DASHSCOPE_API_KEY 中设置' });
    return;
  }

  let url;
  try { url = new URL(base + '/chat/completions'); }
  catch (e) { sendJson(res, 400, { error: 'baseUrl 非法：' + base }); return; }

  const payload = JSON.stringify({
    model: model || CONFIG.defaultModel || 'deepseek-v4.1-flash',
    messages,
    temperature: (typeof temperature === 'number') ? temperature : 0.7,
    max_tokens: (typeof max_tokens === 'number') ? max_tokens : 2000,
    stream: !!stream
  });

  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: CONFIG.timeoutMs || 120000
  };

  const upstream = https.request(options, (upRes) => {
    if (upRes.statusCode !== 200) {
      // 收集错误信息返回给前端
      let errData = '';
      upRes.on('data', (c) => { errData += c; });
      upRes.on('end', () => {
        sendJson(res, 502, { error: '上游返回 ' + upRes.statusCode, detail: errData.slice(0, 800) });
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    upRes.on('data', (chunk) => { res.write(chunk); });
    upRes.on('end', () => { res.end(); });
    upRes.on('error', (e) => { try { res.end(); } catch (_) {} });
  });

  upstream.on('error', (e) => {
    console.error('[chat] upstream error:', e.message);
    if (!res.headersSent) sendJson(res, 502, { error: '上游请求失败：' + e.message });
    else { try { res.end(); } catch (_) {} }
  });
  upstream.on('timeout', () => { upstream.destroy(new Error('upstream timeout')); });

  upstream.write(payload);
  upstream.end();
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  // API
  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, model: CONFIG.defaultModel });
        return;
      }

      // 提示词集合
      if (pathname === '/api/prompts') {
        if (req.method === 'GET') {
          sendJson(res, 200, { items: readDb() });
          return;
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const now = Date.now();
          const item = {
            id: genId(),
            title: (body.title || '未命名提示词').toString().slice(0, 200),
            content: (body.content || '').toString(),
            tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 30) : [],
            category: (body.category || '通用').toString().slice(0, 50),
            favorite: !!body.favorite,
            version: 1,
            history: [],
            createdAt: now,
            updatedAt: now,
            lastUsedAt: body.lastUsedAt || null
          };
          const db = readDb();
          db.unshift(item);
          writeDb(db);
          sendJson(res, 201, { item });
          return;
        }
      }

      // 单条
      const m = pathname.match(/^\/api\/prompts\/([\w\-]+)$/);
      if (m) {
        const id = m[1];
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const body = await readBody(req);
          const db = readDb();
          const idx = db.findIndex((x) => x.id === id);
          if (idx === -1) { sendJson(res, 404, { error: '未找到' }); return; }
          const old = db[idx];
          const updated = {
            ...old,
            title: body.title !== undefined ? body.title.toString().slice(0, 200) : old.title,
            content: body.content !== undefined ? body.content : old.content,
            tags: body.tags !== undefined ? (Array.isArray(body.tags) ? body.tags.map(String).slice(0, 30) : []) : old.tags,
            category: body.category !== undefined ? body.category.toString().slice(0, 50) : old.category,
            favorite: body.favorite !== undefined ? !!body.favorite : old.favorite,
            lastUsedAt: body.lastUsedAt !== undefined ? body.lastUsedAt : old.lastUsedAt,
            updatedAt: Date.now()
          };
          // 记录版本历史（仅当内容变化）
          if (body.content !== undefined && body.content !== old.content) {
            updated.version = (old.version || 1) + 1;
            updated.history = (old.history || []).slice(0, 20);
            updated.history.unshift({
              version: old.version || 1,
              at: old.updatedAt || old.createdAt,
              title: old.title,
              content: old.content
            });
          }
          db[idx] = updated;
          writeDb(db);
          sendJson(res, 200, { item: updated });
          return;
        }
        if (req.method === 'DELETE') {
          const db = readDb();
          const next = db.filter((x) => x.id !== id);
          if (next.length === db.length) { sendJson(res, 404, { error: '未找到' }); return; }
          writeDb(next);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      // 导入（替换或合并）
      if (pathname === '/api/prompts/import' && req.method === 'POST') {
        const body = await readBody(req);
        const incoming = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : null);
        if (!incoming) { sendJson(res, 400, { error: '导入数据格式应为数组或 {items:[]}' }); return; }
        const mode = (body.mode === 'merge') ? 'merge' : 'replace';
        const db = readDb();
        const cleaned = incoming.map((x) => ({
          id: x.id || genId(),
          title: (x.title || '未命名提示词').toString().slice(0, 200),
          content: (x.content || '').toString(),
          tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 30) : [],
          category: (x.category || '通用').toString().slice(0, 50),
          favorite: !!x.favorite,
          version: x.version || 1,
          history: Array.isArray(x.history) ? x.history : [],
          createdAt: x.createdAt || Date.now(),
          updatedAt: x.updatedAt || Date.now(),
          lastUsedAt: x.lastUsedAt || null
        }));
        let result;
        if (mode === 'merge') {
          const map = new Map(db.map((x) => [x.id, x]));
          for (const c of cleaned) map.set(c.id, c);
          result = Array.from(map.values());
        } else {
          result = cleaned;
        }
        writeDb(result);
        sendJson(res, 200, { ok: true, count: result.length });
        return;
      }

      // 导出
      if (pathname === '/api/prompts/export' && req.method === 'GET') {
        const db = readDb();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="prompts-export.json"'
        });
        res.end(JSON.stringify(db, null, 2));
        return;
      }

      // 分类统计
      if (pathname === '/api/stats' && req.method === 'GET') {
        const db = readDb();
        const cats = {};
        let fav = 0;
        for (const x of db) {
          const c = x.category || '通用';
          cats[c] = (cats[c] || 0) + 1;
          if (x.favorite) fav++;
        }
        sendJson(res, 200, { total: db.length, favorite: fav, categories: cats });
        return;
      }

      // LLM 流式代理
      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await readBody(req);
        proxyChat(req, res, body);
        return;
      }

      sendJson(res, 404, { error: '未知接口' });
      return;
    } catch (e) {
      console.error('[api] 错误：', e);
      if (!res.headersSent) sendJson(res, 400, { error: e.message });
      else try { res.end(); } catch (_) {}
      return;
    }
  }

  // 静态
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('Prompt Elite 已启动 →  http://localhost:' + PORT);
  console.log('数据文件：' + DB_FILE);
});
