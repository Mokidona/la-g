'use strict';

/* Лендинг + админка на чистом Node.js без зависимостей.
   Контент хранится в DATA_DIR/content.json, картинки — в DATA_DIR/uploads. */

const http = require('node:http');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const { defaultContent, mergeContent } = require('./lib/default-content');
const { renderPage } = require('./lib/render');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ROOT = __dirname;

const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const BACKUP_FILE = path.join(DATA_DIR, 'content.backup.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.txt');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const ADMIN_DIR = path.join(ROOT, 'admin');
const ASSETS_DIR = path.join(ROOT, 'assets');

const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_JSON_BODY = 1024 * 1024;
const MAX_UPLOAD = 6 * 1024 * 1024;
const MAX_LOGIN_FAILS = 8;
const LOGIN_WINDOW = 15 * 60 * 1000;

let content = null;
let contentVersion = '';
let passwordRecord = null;

const sessions = new Map();
const loginFails = new Map();
const gzipCache = new Map();

/* ---------------------------------------------------------------- утилиты */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function baseHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...baseHeaders(), ...headers });
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...baseHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = MAX_JSON_BODY) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('bad_json'), { status: 400 });
  }
}

function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function cookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const eq = part.indexOf('=');
    if (eq > 0) acc[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    return acc;
  }, {});
}

function sessionCookie(token, req, maxAge = SESSION_TTL / 1000) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.round(maxAge))}`];
  if (isSecure(req)) flags.push('Secure');
  return `lfk_admin=${token}; ${flags.join('; ')}`;
}

/* ----------------------------------------------------------------- контент */

function hashContent(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

async function writeJsonFile(file, value) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

async function loadContent() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(CONTENT_FILE, 'utf8');
    content = mergeContent(defaultContent, JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[content] не удалось прочитать content.json, берём исходный:', error.message);
    }
    content = mergeContent(defaultContent, null);
    await writeJsonFile(CONTENT_FILE, content);
  }

  contentVersion = hashContent(content);
}

async function saveContent(next) {
  if (content) await writeJsonFile(BACKUP_FILE, content);
  content = next;
  contentVersion = hashContent(content);
  await writeJsonFile(CONTENT_FILE, content);
}

/* -------------------------------------------------------------------- вход */

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, record) {
  if (!record || typeof password !== 'string') return false;
  const actual = Buffer.from(hashPassword(password, record.salt), 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function loadPassword() {
  try {
    passwordRecord = JSON.parse(await fs.readFile(ADMIN_FILE, 'utf8'));
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[auth] файл admin.json повреждён:', error.message);
    }
  }

  const fromEnv = process.env.ADMIN_PASSWORD;
  const password = fromEnv || crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  passwordRecord = {
    salt,
    hash: hashPassword(password, salt),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(ADMIN_FILE, passwordRecord);

  if (!fromEnv) {
    await fs.writeFile(
      PASSWORD_FILE,
      `Пароль администратора: ${password}\nСмените его в админке: /admin → Резервная копия.\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    console.log(`[auth] пароль администратора создан и записан в ${PASSWORD_FILE}`);
  }
}

function createSession(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL });
  res.setHeader('Set-Cookie', sessionCookie(token, req));
  return token;
}

function getSession(req) {
  const token = cookies(req).lfk_admin;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
}

function requireAuth(req, res) {
  if (getSession(req)) return true;
  sendJson(res, 401, { error: 'unauthorized' });
  return false;
}

function loginBlocked(ip) {
  const entry = loginFails.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    loginFails.delete(ip);
    return false;
  }
  return entry.count >= MAX_LOGIN_FAILS;
}

function noteLoginFail(ip) {
  const now = Date.now();
  const entry = loginFails.get(ip);
  if (!entry || now > entry.until) {
    loginFails.set(ip, { count: 1, until: now + LOGIN_WINDOW });
    return;
  }
  entry.count += 1;
  entry.until = now + LOGIN_WINDOW;
}

/* -------------------------------------------------------------- статика */

function resolveInside(base, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const target = path.resolve(base, `.${decoded}`);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return target.startsWith(prefix) ? target : null;
}

async function sendFile(req, res, filePath, cacheControl) {
  let stat;
  try {
    stat = await fs.stat(filePath);
    if (stat.isDirectory()) throw Object.assign(new Error('dir'), { code: 'ENOENT' });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  const compressible = ['.html', '.css', '.js', '.json', '.svg', '.txt'].includes(ext);
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

  if (compressible && acceptsGzip) {
    const key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    let cached = gzipCache.get(key);
    if (!cached) {
      const source = await fs.readFile(filePath);
      cached = zlib.gzipSync(source, { level: 9 });
      gzipCache.clear();
      gzipCache.set(key, cached);
    }
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = cached.length;
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, { ...baseHeaders(), ...headers });
    res.end(cached);
    return;
  }

  res.writeHead(200, { ...baseHeaders(), ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fssync.createReadStream(filePath).pipe(res);
}

/* ---------------------------------------------------------------- загрузки */

const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/gif': { ext: 'gif', magic: [0x47, 0x49, 0x46, 0x38] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};

async function handleUpload(req, res) {
  const body = await readJson(req, MAX_UPLOAD + 1024 * 64);
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(body.data || ''));
  if (!match) {
    sendJson(res, 400, { error: 'bad_data' });
    return;
  }

  const type = match[1].toLowerCase();
  const format = IMAGE_TYPES[type];
  if (!format) {
    sendJson(res, 400, { error: 'unsupported_type' });
    return;
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD) {
    sendJson(res, 413, { error: 'too_large' });
    return;
  }
  if (!format.magic.every((byte, index) => buffer[index] === byte)) {
    sendJson(res, 400, { error: 'bad_image' });
    return;
  }

  const name = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${format.ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), buffer);
  sendJson(res, 200, { url: `/uploads/${name}` });
}

/* ------------------------------------------------------------------ роутер */

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/login') {
    const ip = clientIp(req);
    if (loginBlocked(ip)) {
      sendJson(res, 429, { error: 'too_many_attempts' });
      return true;
    }
    const body = await readJson(req);
    if (!verifyPassword(String(body.password || ''), passwordRecord)) {
      noteLoginFail(ip);
      sendJson(res, 401, { error: 'bad_password' });
      return true;
    }
    loginFails.delete(ip);
    createSession(req, res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (route === 'GET /api/session') {
    sendJson(res, 200, { authed: Boolean(getSession(req)) });
    return true;
  }

  if (route === 'POST /api/logout') {
    const session = getSession(req);
    if (session) sessions.delete(session.token);
    res.setHeader('Set-Cookie', sessionCookie('', req, 0));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/api/content' && !getSession(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (route === 'GET /api/content') {
    sendJson(res, 200, { content, version: contentVersion });
    return true;
  }

  if (route === 'PUT /api/content') {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'bad_origin' });
      return true;
    }
    const body = await readJson(req);
    if (!body || typeof body.content !== 'object') {
      sendJson(res, 400, { error: 'bad_content' });
      return true;
    }
    await saveContent(mergeContent(defaultContent, body.content));
    sendJson(res, 200, { ok: true, version: contentVersion, content });
    return true;
  }

  if (route === 'POST /api/preview') {
    if (!requireAuth(req, res)) return true;
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'bad_origin' });
      return true;
    }

    const body = await readJson(req);
    const lang = body.lang === 'kz' ? 'kz' : 'ru';
    const next = mergeContent(defaultContent, body.content && typeof body.content === 'object' ? body.content : {});
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const origin = `${proto}://${req.headers.host || `localhost:${PORT}`}`;
    const html = renderPage(next, { lang, origin, edit: true });

    sendJson(res, 200, { html });
    return true;
  }

  if (route === 'POST /api/upload') {
    if (!requireAuth(req, res)) return true;
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'bad_origin' });
      return true;
    }
    await handleUpload(req, res);
    return true;
  }

  if (route === 'POST /api/password') {
    if (!requireAuth(req, res)) return true;
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'bad_origin' });
      return true;
    }
    const body = await readJson(req);
    if (!verifyPassword(String(body.current || ''), passwordRecord)) {
      sendJson(res, 400, { error: 'bad_current' });
      return true;
    }
    const next = String(body.next || '');
    if (next.length < 8) {
      sendJson(res, 400, { error: 'short_password' });
      return true;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    passwordRecord = {
      salt,
      hash: hashPassword(next, salt),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(ADMIN_FILE, passwordRecord);
    await fs.rm(PASSWORD_FILE, { force: true });
    sessions.clear();
    createSession(req, res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (route === 'POST /api/reset') {
    if (!requireAuth(req, res)) return true;
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'bad_origin' });
      return true;
    }
    await saveContent(mergeContent(defaultContent, null));
    sendJson(res, 200, { ok: true, content });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  let url;
  try {
    url = new URL(req.url, `http://${host}`);
  } catch {
    send(res, 400, 'Bad request');
    return;
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: 'not_found' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }

    if (url.pathname === '/healthz') {
      send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return;
    }

    /* Лендинг рендерится на сервере на выбранном языке. */
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const lang = url.searchParams.get('lang') === 'kz' ? 'kz' : 'ru';
      const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      const origin = `${proto}://${host}`;
      const etag = `"${contentVersion}-${lang}"`;

      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ...baseHeaders(), ETag: etag, 'Cache-Control': 'no-cache' });
        res.end();
        return;
      }

      const html = renderPage(content, { lang, origin });
      const headers = {
        ...baseHeaders(),
        'Content-Type': MIME['.html'],
        'Cache-Control': 'no-cache',
        ETag: etag,
      };
      if (lang === 'kz') {
        res.setHeader('Content-Language', 'kk');
      } else {
        res.setHeader('Content-Language', 'ru');
      }
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const gz = zlib.gzipSync(Buffer.from(html), { level: 9 });
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        headers.Vary = 'Accept-Encoding';
        res.writeHead(200, headers);
        res.end(gz);
        return;
      }
      res.writeHead(200, headers);
      res.end(html);
      return;
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname.startsWith('/admin/')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');

      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        await sendFile(req, res, path.join(ADMIN_DIR, 'index.html'), 'no-cache');
        return;
      }

      const file = resolveInside(ADMIN_DIR, url.pathname.slice('/admin'.length));
      if (!file) return send(res, 404, 'Not found');
      await sendFile(req, res, file, 'no-cache');
      return;
    }

    if (url.pathname === '/styles.css' || url.pathname === '/script.js') {
      await sendFile(req, res, path.join(ROOT, url.pathname), 'no-cache');
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      const file = resolveInside(ASSETS_DIR, url.pathname.slice('/assets'.length));
      if (!file) return send(res, 404, 'Not found');
      await sendFile(req, res, file, 'public, max-age=604800');
      return;
    }

    if (url.pathname.startsWith('/uploads/')) {
      const file = resolveInside(UPLOAD_DIR, url.pathname.slice('/uploads'.length));
      if (!file) return send(res, 404, 'Not found');
      await sendFile(req, res, file, 'public, max-age=31536000, immutable');
      return;
    }

    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (error) {
    console.error('[server]', req.method, url.pathname, error);
    if (!res.headersSent) {
      sendJson(res, error.status || 500, { error: 'server_error' });
    } else {
      res.end();
    }
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires < now) sessions.delete(token);
  }
  for (const [ip, entry] of loginFails) {
    if (entry.until < now) loginFails.delete(ip);
  }
}, 10 * 60 * 1000).unref();

async function start() {
  await loadContent();
  await loadPassword();
  server.listen(PORT, () => {
    console.log(`[server] лендинг: http://localhost:${PORT}/  админка: http://localhost:${PORT}/admin`);
    console.log(`[server] данные: ${DATA_DIR}`);
  });
}

start().catch((error) => {
  console.error('[server] не удалось запуститься:', error);
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
