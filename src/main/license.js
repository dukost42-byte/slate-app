'use strict';
// Клиентская часть лицензирования (main-процесс).
//
// Что делает:
//  • считает отпечаток устройства (стабильный ID машины, хешируется — сырой UUID наружу не уходит);
//  • ходит на сервер: регистрация/вход, привязка ключа, активация/проверка устройства;
//  • хранит сессию и подписанный токен лицензии (userData/auth.json);
//  • проверяет ПОДПИСЬ токена публичным ключом (офлайн, без доверия к сети);
//  • даёт статус лицензии и гейт для установки.
//
// Принцип: «лицензия валидна» решает не клиент, а сервер — клиент лишь проверяет,
// что подписанный сервером токен настоящий, привязан к этому устройству и не истёк.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const config = require('./config');

let AUTH_FILE = null;
let PUB_KEY_FILE = null;   // bundled resources/public_key.pem (может отсутствовать)
let publicKeyPem = null;   // кешируется в памяти

function init(userDataDir, bundledPubKeyPath) {
  AUTH_FILE = path.join(userDataDir, 'auth.json');
  PUB_KEY_FILE = bundledPubKeyPath;
}

/* ---------------- хранилище сессии/токена ---------------- */
function readAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch (e) { return {}; }
}
function writeAuth(data) {
  try { fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { /* noop */ }
}
function clearAuth() {
  const a = readAuth();
  writeAuth({ publicKey: a.publicKey }); // ключ проверки сохраняем — он не секретный
}

/* ---------------- отпечаток устройства ---------------- */
function rawMachineId() {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' });
      const m = out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else if (process.platform === 'win32') {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      if (m) return m[1];
    }
  } catch (e) { /* упадём в фолбэк ниже */ }
  // фолбэк: стабильный id, сохранённый локально
  const a = readAuth();
  if (a.fallbackId) return a.fallbackId;
  const id = crypto.randomBytes(16).toString('hex');
  writeAuth(Object.assign(readAuth(), { fallbackId: id }));
  return id;
}
function sha256hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// то, что отправляем серверу (сырой UUID не покидает машину)
function fingerprint() { return sha256hex(rawMachineId() + '::slate'); }
function deviceName() { return os.hostname() || 'Устройство'; }

/* ---------------- HTTP к серверу ---------------- */
async function apiPost(pathname, body) {
  const res = await fetch(config.BACKEND_URL + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* пусто */ }
  return Object.assign({ _status: res.status }, data);
}

/* ---------------- публичный ключ (для проверки подписи) ---------------- */
async function ensurePublicKey() {
  if (publicKeyPem) return publicKeyPem;
  // 1) встроенный файл (самый надёжный путь)
  try {
    if (PUB_KEY_FILE && fs.existsSync(PUB_KEY_FILE)) {
      publicKeyPem = fs.readFileSync(PUB_KEY_FILE, 'utf8');
      if (publicKeyPem.includes('PUBLIC KEY')) return publicKeyPem;
    }
  } catch (e) { /* дальше */ }
  // 2) кеш в userData
  const a = readAuth();
  if (a.publicKey && a.publicKey.includes('PUBLIC KEY')) { publicKeyPem = a.publicKey; return publicKeyPem; }
  // 3) скачать с сервера один раз и закешировать
  try {
    const res = await fetch(config.BACKEND_URL + '/public-key');
    const pem = await res.text();
    if (pem && pem.includes('PUBLIC KEY')) {
      publicKeyPem = pem;
      writeAuth(Object.assign(readAuth(), { publicKey: pem }));
      return pem;
    }
  } catch (e) { /* нет сети */ }
  return null;
}

/* ---------------- проверка токена лицензии ---------------- */
// Возвращает payload, если подпись верна, устройство совпадает и токен не истёк; иначе null.
async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const pem = await ensurePublicKey();
  if (!pem) return null;
  try {
    const data = Buffer.from(parts[0] + '.' + parts[1]);
    const sig = Buffer.from(parts[2], 'base64url');
    const ok = crypto.verify('RSA-SHA256', data, pem, sig);
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;       // токен истёк (офлайн-грейс кончился)
    if (payload.dev && payload.dev !== sha256hex(fingerprint())) return null; // не это устройство
    return payload;
  } catch (e) { return null; }
}

/* ---------------- операции ---------------- */
async function signup(email, password, key) {
  const r = await apiPost('/auth/signup', { email, password, key: key || undefined });
  if (r._status >= 200 && r._status < 300 && r.session) {
    writeAuth(Object.assign(readAuth(), { session: r.session, email }));
    return { ok: true };
  }
  return { ok: false, error: r.error || 'не удалось зарегистрироваться' };
}

async function login(email, password) {
  const r = await apiPost('/auth/login', { email, password });
  if (r._status >= 200 && r._status < 300 && r.session) {
    writeAuth(Object.assign(readAuth(), { session: r.session, email }));
    return { ok: true };
  }
  return { ok: false, error: r.error || 'неверный email или пароль' };
}

async function redeem(key) {
  const a = readAuth();
  if (!a.session) return { ok: false, error: 'нужен вход' };
  const r = await apiPost('/license/redeem', { session: a.session, key });
  if (r.ok) return { ok: true };
  return { ok: false, error: r.error || 'не удалось привязать ключ', code: r.code };
}

// Активировать это устройство и сохранить свежий подписанный токен.
async function ensureLicense() {
  const a = readAuth();
  if (!a.session) return { ok: false, code: 'no_session' };
  let r;
  try {
    r = await apiPost('/license/activate', { session: a.session, fingerprint: fingerprint(), name: deviceName(), platform: process.platform });
  } catch (e) {
    return { ok: false, code: 'offline' };
  }
  if (r.token) {
    const payload = await verifyToken(r.token);
    if (!payload) return { ok: false, code: 'bad_token' };
    writeAuth(Object.assign(readAuth(), { token: r.token, plan: r.plan || payload.plan, expiresAt: r.expires_at || payload.lexp || null }));
    return { ok: true, license: licenseInfoFrom(payload, r) };
  }
  // сервер отказал: нет лицензии / лимит устройств / сессия истекла
  return { ok: false, code: r.code || (r._status === 401 ? 'no_session' : 'error'), error: r.error };
}

async function listDevices() {
  const a = readAuth();
  if (!a.session) return { ok: false, error: 'нужен вход' };
  const r = await apiPost('/license/devices', { session: a.session });
  if (r.ok) return { ok: true, devices: r.devices || [], max_devices: r.max_devices, plan: r.plan, expires_at: r.expires_at };
  return { ok: false, error: r.error || 'нет данных', code: r.code };
}

async function logout() {
  const a = readAuth();
  // освобождаем слот устройства на сервере (не критично, если не выйдет)
  try { if (a.session) await apiPost('/license/deactivate', { session: a.session, fingerprint: fingerprint() }); } catch (e) { /* noop */ }
  clearAuth();
  publicKeyPem = publicKeyPem; // остаётся в памяти
  return { ok: true };
}

function licenseInfoFrom(payload, extra) {
  return {
    valid: true,
    plan: (extra && extra.plan) || payload.plan || 'beta',
    expiresAt: (extra && extra.expires_at) || payload.lexp || null
  };
}

// Статус для UI (офлайн, по сохранённому токену — сеть не нужна).
async function getState() {
  const a = readAuth();
  if (!a.session) return { authed: false };
  const payload = a.token ? await verifyToken(a.token) : null;
  const license = payload
    ? { valid: true, plan: a.plan || payload.plan || 'beta', expiresAt: a.expiresAt || payload.lexp || null }
    : { valid: false };
  return { authed: true, email: a.email || null, license };
}

// Гейт установки: есть ли действующая лицензия. Если токен истёк, но есть сессия — пробуем обновить онлайн.
async function hasValidLicense() {
  const a = readAuth();
  if (a.token && (await verifyToken(a.token))) return true;
  if (a.session) { const r = await ensureLicense(); return !!(r && r.ok); }
  return false;
}

module.exports = {
  init, getState, hasValidLicense,
  signup, login, redeem, ensureLicense, listDevices, logout,
  fingerprint, deviceName
};
