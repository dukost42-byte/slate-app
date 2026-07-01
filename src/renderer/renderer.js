'use strict';
// Renderer общается с main только через window.api (см. preload).
// Никакого Node здесь. CSP строгий — события вешаем через addEventListener (делегирование),
// inline-обработчиков (onclick="...") нет намеренно.

let HOSTS = [];
let CATALOG = [];
let currentHost = null;
let searchQuery = '';
let theme = 'dark';
let cepEnabled = false;   // включён ли режим разработчика CEP (PlayerDebugMode)

const hostBadge = (c) => `<span class="host ${c}">${c === 'ae' ? 'Ae' : 'Pr'}</span>`;
const badges = (arr) => arr.map(hostBadge).join('');

/* ---------------- rail ---------------- */
function buildRail() {
  const apps = HOSTS.map((h) =>
    `<button class="railbtn app ${h.code}" data-v="host:${h.id}" title="${h.name} ${h.version}">
       <span class="tile"><span class="ab">${h.code === 'ae' ? 'Ae' : 'Pr'}</span><span class="yr">${h.version}</span></span></button>`
  ).join('');
  document.getElementById('rail').innerHTML = `
    <div class="apps">${apps}</div>
    <div class="railspace"></div>
    <button class="railbtn ic" data-v="account" title="Аккаунт"><svg class="ic"><use href="#i-user"/></svg></button>
    <button class="railbtn ic" data-v="settings" title="Настройки"><svg class="ic"><use href="#i-set"/></svg></button>`;
}

function setActive(v) {
  document.querySelectorAll('#rail [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
}

/* ---------------- проверка версий: бейджи + автопроверка ---------------- */
function hasUpdateForHost(code) {
  return CATALOG.some((s) => s.owned && s.hosts.includes(code) && scriptState(s) === 'update');
}

function applyRailBadges() {
  HOSTS.forEach((h) => {
    const btn = document.querySelector('#rail [data-v="host:' + h.id + '"]');
    if (!btn) return;
    const has = hasUpdateForHost(h.code);
    let dot = btn.querySelector('.upddot');
    if (has && !dot) { dot = document.createElement('span'); dot.className = 'upddot'; btn.appendChild(dot); }
    else if (!has && dot) { dot.remove(); }
  });
}

let lastCheck = 0;
async function autoCheck() {
  console.log('[releases] автопроверка версий');
  try { await window.api.refreshReleases(); } catch (e) { return; }
  CATALOG = await window.api.getCatalog();
  applyRailBadges();
  if (currentHost) renderHostCards();
  lastCheck = Date.now();
  fillLastCheck();
}

function fillLastCheck() {
  const el = document.getElementById('lastCheckTime');
  if (!el) return;
  el.textContent = lastCheck
    ? new Date(lastCheck).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ' · авто каждые 20 мин'
    : 'ещё не выполнялась';
}

function select(v) {
  searchQuery = '';
  setActive(v);
  if (v.indexOf('host:') === 0) {
    currentHost = HOSTS.find((h) => h.id === v.slice(5));
    renderHost(currentHost);
  } else if (v === 'account') {
    currentHost = null; renderAccount();
  } else {
    currentHost = null; renderSettings();
  }
}

/* ---------------- host view (с поиском) ---------------- */
function renderHost(host) {
  const code = host.code;
  const cepHost = (code === 'ae' || code === 'pr');
  const cepBanner = !cepHost ? '' : (cepEnabled
    ? `<div class="cepok"><svg class="ic"><use href="#i-check"/></svg><span>Режим разработчика CEP включён</span></div>`
    : `<div class="banner">
         <div><b>Расширения CEP</b> требуют режим разработчика (расширение не подписано). Включите один раз.</div>
         <button class="btn ghost" data-act="cepdebug">Включить режим разработчика</button>
       </div>`);
  document.getElementById('view').innerHTML = `
    <div class="head">
      <div class="top">
        <div class="hicon ${code}">${code === 'ae' ? 'Ae' : 'Pr'}</div>
        <div>
          <h1>${host.name} ${host.version} ${host.demo ? '<span class="demo">демо</span>' : ''}</h1>
          <div class="sub">${host.demo ? 'демо-режим · Adobe не найден' : (host.cepPath || host.scriptsPath)}</div>
        </div>
        <div style="flex:1"></div>
        <button class="btn subtle" data-act="checkupd">Проверить обновления</button>
      </div>
      <div class="search"><svg class="ic"><use href="#i-search"/></svg>
        <input id="searchInput" placeholder="Поиск скриптов для ${host.name}" autocomplete="off"></div>
    </div>
    <div class="body">${cepBanner}<div id="cardsBody"></div></div>`;
  document.getElementById('searchInput').value = searchQuery;
  renderHostCards();
}

function compareSemver(a, b) {
  // -1 если a<b, 0 если равны, 1 если a>b
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function scriptState(s) {
  if (s.exp) return 'exp';
  if (!s.installed) return 'install';
  const c = compareSemver(s.installedVersion, s.version);
  if (c < 0) return 'update';     // доступна новее установленной
  if (c > 0) return 'rollback';   // доступна старше установленной (откат)
  return 'installed';
}

function cardOwned(s) {
  const st = scriptState(s);
  const meta = st === 'exp'
    ? `<div class="cmeta exp"><svg class="ic"><use href="#i-clock"/></svg>Поддержка истекла ${s.supportUntil}</div>`
    : `<div class="cmeta"><svg class="ic"><use href="#i-clock"/></svg>Обновления до ${s.supportUntil}</div>`;

  let pill = '', btn = '';
  if (st === 'install') {
    btn = `<button class="btn primary" data-act="install" data-id="${s.id}" data-host="${currentHost.id}"><svg class="ic"><use href="#i-dl"/></svg>Установить</button>`;
  } else if (st === 'installed') {
    pill = `<span class="pill ok"><svg class="ic"><use href="#i-check"/></svg>Установлено</span>`;
    btn = `<button class="btn subtle" data-act="uninstall" data-id="${s.id}" data-host="${currentHost.id}">Удалить</button>`;
  } else if (st === 'update') {
    pill = `<span class="pill upd"><svg class="ic"><use href="#i-upd"/></svg>Обновление</span>`;
    btn = `<button class="btn primary" data-act="install" data-id="${s.id}" data-host="${currentHost.id}">Обновить</button>`;
  } else if (st === 'rollback') {
    pill = `<span class="pill roll"><svg class="ic"><use href="#i-upd"/></svg>Откат</span>`;
    btn = `<button class="btn subtle" data-act="install" data-id="${s.id}" data-host="${currentHost.id}">Откатить до v${s.version}</button>`;
  } else {
    pill = `<span class="pill exp"><svg class="ic"><use href="#i-warn"/></svg>Поддержка истекла</span>`;
    btn = `<button class="btn subtle" data-act="nav" data-v="account">Продлить</button>`;
  }
  const pack = s.pack ? `<span class="packtag">пак · ${s.count}</span>` : '';
  const verNum = s.installed ? s.installedVersion : s.version;
  const ver = verNum ? `<span class="cver mono">v${verNum}</span>` : '';
  const upnote = (st === 'update' || st === 'rollback')
    ? `<div class="upnote"><svg class="ic"><use href="#i-upd"/></svg><span>v${s.installedVersion} → <b>v${s.version}</b>${s.notes ? ' · ' + s.notes : ''}</span></div>`
    : '';
  return `<div class="card">
    <div class="row1">
      <div class="thumb"><span class="mono" style="font-weight:700;font-size:16px">${s.name[0]}</span></div>
      <div class="cmain">
        <div class="nm">${s.name} ${ver} ${pack} ${badges(s.hosts)}</div>
        <div class="desc">${s.desc}</div>
        ${meta}${upnote}
      </div>
    </div>
    <div class="row2">${pill || '<span></span>'}${btn}</div>
  </div>`;
}

function cardLocked(s) {
  const pack = s.pack ? `<span class="packtag">пак · ${s.count}</span>` : '';
  const sub = s.pack ? `<div class="cmeta">${s.count} инструментов в паке</div>` : '';
  return `<div class="card locked">
    <div class="row1">
      <div class="thumb"><span class="mono" style="font-weight:700;font-size:16px">${s.name[0]}</span>
        <span class="lockbadge"><svg class="ic"><use href="#i-lock"/></svg></span></div>
      <div class="cmain">
        <div class="nm">${s.name} ${pack} ${badges(s.hosts)}</div>
        <div class="desc">${s.desc}</div>
        ${sub}
      </div>
    </div>
    <div class="row2">
      <span class="price">${s.price}</span>
      <button class="btn buy" data-act="buy" data-url="https://example.com/buy/${s.id}"><svg class="ic"><use href="#i-cart"/></svg>Купить</button>
    </div>
  </div>`;
}

function renderHostCards() {
  if (!currentHost) return;
  const code = currentHost.code;
  const q = searchQuery.trim().toLowerCase();
  const match = (s) => !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q);
  const all = CATALOG.filter((s) => s.hosts.includes(code) && match(s));
  const owned = all.filter((s) => s.owned);
  const locked = all.filter((s) => !s.owned);

  let html = '';
  if (owned.length) html += `<div class="grouplabel">Ваши скрипты</div><div class="cards">${owned.map(cardOwned).join('')}</div>`;
  if (locked.length) html += `<div class="grouplabel">Доступно к покупке</div><div class="cards">${locked.map(cardLocked).join('')}</div>`;
  if (!owned.length && !locked.length) html = `<div class="empty"><svg class="ic"><use href="#i-search"/></svg><div>Ничего не найдено</div></div>`;
  document.getElementById('cardsBody').innerHTML = html;
}

/* ---------------- install (реальная загрузка с прогрессом) ---------------- */
async function install(id, hostId, btn) {
  const card = btn.closest('.card');
  const row2 = card.querySelector('.row2');
  row2.innerHTML =
    `<span class="dlstate mono" data-st="${id}">Загрузка… 0%</span>` +
    `<div class="prog"><i data-prog="${id}" style="width:0%"></i></div>`;
  const res = await window.api.installScript(id, hostId);
  if (res && res.ok) {
    const s = CATALOG.find((x) => x.id === id);
    s.installed = true; s.installedVersion = s.version;
    renderHostCards();
  } else {
    alert('Не удалось установить: ' + ((res && res.error) || 'неизвестная ошибка'));
    renderHostCards();
  }
}

function onInstallProgress(scriptId, percent) {
  const bar = document.querySelector('[data-prog="' + scriptId + '"]');
  if (bar) bar.style.width = percent + '%';
  const st = document.querySelector('[data-st="' + scriptId + '"]');
  if (st) st.textContent = percent >= 100 ? 'Установка…' : ('Загрузка… ' + percent + '%');
}

async function uninstall(id, hostId, btn) {
  if (!window.confirm('Удалить плагин с этого устройства?')) return;
  btn.disabled = true; btn.textContent = 'Удаляю…';
  const res = await window.api.uninstallScript(id, hostId);
  if (res && res.ok) {
    const s = CATALOG.find((x) => x.id === id);
    s.installed = false; s.installedVersion = null;
    renderHostCards(); applyRailBadges();
  } else {
    btn.disabled = false; btn.textContent = 'Удалить';
    alert('Не удалось удалить: ' + ((res && res.error) || 'неизвестная ошибка'));
  }
}

/* ---------------- account ---------------- */
async function renderAccount() {
  const email = (AUTH && AUTH.email) || '—';
  document.getElementById('view').innerHTML = `
    <div class="head"><div class="top">
      <div class="hicon" style="background:var(--bg-soft-2);color:var(--text-secondary)"><svg class="ic"><use href="#i-user"/></svg></div>
      <div><h1>Аккаунт</h1><div class="sub">${email}</div></div></div></div>
    <div class="body" id="accBody"><div class="empty"><div>Загрузка…</div></div></div>`;

  let info; try { info = await window.api.licenseDevices(); } catch (e) { info = { ok: false }; }
  const body = document.getElementById('accBody');
  if (!body) return;

  const lic = (AUTH && AUTH.license) || {};
  const plan = (info && info.plan) || lic.plan || 'beta';
  const exp = (info && info.expires_at) || lic.expiresAt || null;
  const expStr = exp ? new Date(exp).toLocaleDateString('ru-RU') : 'бессрочно';
  const maxDev = (info && info.max_devices) || 1;
  const devs = (info && info.devices) || [];
  const used = devs.length || (lic.valid ? 1 : 0);
  const pct = Math.min(100, Math.round((used / Math.max(1, maxDev)) * 100));

  const devRows = devs.length ? devs.map((d) => `
    <div class="devrow">
      <div class="di"><svg class="ic"><use href="#i-laptop"/></svg></div>
      <div><div class="dn">${d.name || 'Устройство'}<span class="tag">активно</span></div>
        <div class="dm">${d.platform || ''}${d.last_seen ? ' · был ' + new Date(d.last_seen).toLocaleDateString('ru-RU') : ''}</div></div>
      <div class="spacer"></div>
    </div>`).join('')
    : `<div class="devrow"><div class="di"><svg class="ic"><use href="#i-laptop"/></svg></div>
        <div><div class="dn">Это устройство<span class="tag">активно</span></div><div class="dm">${window.api.platform}</div></div>
        <div class="spacer"></div></div>`;

  body.innerHTML = `
    <div class="panel">
      <h3>Устройства</h3>
      <p class="pd">Лицензия привязана к устройству. Чтобы перенести на другое — нажмите «Выйти» здесь, затем войдите на новом устройстве.</p>
      <div class="slots"><span>Активаций: <b class="mono">${used} из ${maxDev}</b></span><span class="slotbar"><i style="width:${pct}%"></i></span></div>
      ${devRows}
      <div style="margin-top:14px"><button class="btn subtle" data-act="logout">Выйти / деактивировать это устройство</button></div>
    </div>
    <div class="panel">
      <h3>Подписка</h3>
      <div class="kv"><span class="k">Тариф</span><span class="val">${plan}</span></div>
      <div class="kv"><span class="k">Лицензия</span><span class="val ${lic.valid ? 'ok' : ''}">${lic.valid ? 'активна' : 'не активна'}</span></div>
      <div class="kv"><span class="k">Действует до</span><span class="val ${lic.valid ? 'ok' : ''}">${expStr}</span></div>
    </div>`;
}

/* ---------------- settings ---------------- */
function renderSettings() {
  document.getElementById('view').innerHTML = `
    <div class="head"><div class="top">
      <div class="hicon" style="background:var(--bg-soft-2);color:var(--text-secondary)"><svg class="ic"><use href="#i-set"/></svg></div>
      <div><h1>Настройки</h1><div class="sub">Slate</div></div></div></div>
    <div class="body">
      <div class="panel">
        <div class="setrow"><div><div class="sl">Версия приложения</div><div class="ss" id="appVerStatus">проверяю…</div></div>
          <button class="btn subtle" data-act="appupd">Проверить</button></div>
        <div class="setrow"><div><div class="sl">Источник релизов</div><div class="ss" id="relSource">…</div></div></div>
        <div class="setrow"><div><div class="sl">Последняя проверка версий</div><div class="ss" id="lastCheckTime">…</div></div>
          <button class="btn subtle" data-act="checkupd2">Проверить сейчас</button></div>
      </div>
      <div class="panel">
        <div class="setrow"><div><div class="sl">Тема</div><div class="ss">Тёмная — как в панелях AE и Premiere</div></div>
          <div class="seg"><button data-theme="dark" class="${theme === 'dark' ? 'on' : ''}">Тёмная</button><button data-theme="light" class="${theme === 'light' ? 'on' : ''}">Светлая</button></div></div>
        <div class="setrow"><div><div class="sl">Автообновление скриптов</div><div class="ss">В пределах активной поддержки</div></div><span class="sw"></span></div>
        <div class="setrow"><div><div class="sl">Запуск при старте системы</div><div class="ss">Открывать Slate в фоне</div></div><span class="sw off"></span></div>
      </div>
      <div class="panel">
        <div class="setrow"><div><div class="sl">Выйти из аккаунта</div><div class="ss">Завершить сессию на этом устройстве</div></div>
          <button class="btn subtle" data-act="logout">Выйти</button></div>
      </div>
    </div>`;
  refreshAppVersion();
  refreshReleaseInfo();
  fillLastCheck();
}

async function refreshReleaseInfo() {
  const el = document.getElementById('relSource');
  if (!el) return;
  let info;
  try { info = await window.api.releasesInfo(); } catch (e) { el.textContent = '—'; return; }
  if (info.source === 'remote') {
    let host = info.url;
    try { host = new URL(info.url).host; } catch (e) { /* оставим как есть */ }
    el.textContent = 'remote · ' + host;
  } else {
    el.textContent = 'local · встроенные файлы';
  }
}

async function refreshAppVersion() {
  const el = document.getElementById('appVerStatus');
  if (!el) return;
  el.textContent = 'проверяю…';
  let r;
  try { r = await window.api.checkAppUpdate(); }
  catch (e) { el.textContent = 'не удалось проверить'; return; }
  if (r.hasUpdate) {
    el.innerHTML = 'Доступна версия ' + r.latest + ' · <span class="lnk" data-act="appdl" data-url="' + r.url + '">Скачать</span>';
  } else if (r.latest) {
    el.textContent = 'Установлена последняя версия ' + r.current;
  } else {
    el.textContent = 'Текущая версия ' + r.current;
  }
}

/* ---------------- theme ---------------- */
function setTheme(mode) {
  theme = mode;
  document.documentElement.classList.toggle('light', mode === 'light');
  document.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === mode));
}

/* ---------------- event delegation ---------------- */
function onViewClick(e) {
  const sw = e.target.closest('.sw');
  if (sw) { sw.classList.toggle('off'); return; }
  const seg = e.target.closest('[data-theme]');
  if (seg) { setTheme(seg.dataset.theme); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'install') install(act.dataset.id, act.dataset.host, act);
  else if (a === 'uninstall') uninstall(act.dataset.id, act.dataset.host, act);
  else if (a === 'buy') window.api.openExternal(act.dataset.url);
  else if (a === 'nav') select(act.dataset.v);
  else if (a === 'checkupd') checkUpdates(act);
  else if (a === 'checkupd2') autoCheck();
  else if (a === 'cepdebug') enableCepDebug(act);
  else if (a === 'appupd') refreshAppVersion();
  else if (a === 'appdl') window.api.openExternal(act.dataset.url);
  else if (a === 'logout' || a === 'do-logout') doLogout();
  else if (a === 'do-login') doAuth('login', act);
  else if (a === 'do-register') doAuth('register', act);
  else if (a === 'do-redeem') doRedeem(act);
  else if (a === 'show-register') showAuth('register');
  else if (a === 'show-login') showAuth('login');
  else if (a === 'retry') route();
}

async function checkUpdates(btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Проверка…';
  try { await window.api.refreshReleases(); } catch (e) { /* покажем по факту сравнения */ }
  CATALOG = await window.api.getCatalog();
  if (currentHost) renderHostCards();
  applyRailBadges();
  const n = CATALOG.filter((s) => scriptState(s) === 'update').length;
  btn.disabled = false;
  btn.textContent = n > 0 ? ('Обновлений: ' + n) : 'Обновлений нет';
  setTimeout(() => { if (btn.isConnected) btn.textContent = orig; }, 2500);
}

async function enableCepDebug(btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Включаю…';
  const res = await window.api.enableCepDebug();
  btn.disabled = false; btn.textContent = orig;
  if (res && res.ok) {
    cepEnabled = true;
    const banner = document.querySelector('.body .banner');
    if (banner) banner.outerHTML = '<div class="cepok"><svg class="ic"><use href="#i-check"/></svg><span>Режим разработчика CEP включён</span></div>';
    alert('Режим разработчика CEP включён. Перезапустите Adobe (After Effects / Premiere Pro), затем Window → Extensions.');
  } else {
    alert('Не удалось включить автоматически: ' + ((res && res.error) || 'ошибка') + '\\nМожно включить вручную (см. README плагина).');
  }
}

/* ---------------- auth: экраны ---------------- */
let AUTH = null;
let appStarted = false;
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function authFormHtml(mode) {
  const isLogin = mode === 'login';
  return `<div class="auth"><div class="authcard">
    <div class="authbrand">Slate</div>
    <div class="authttl">${isLogin ? 'Вход в аккаунт' : 'Регистрация'}</div>
    <div class="field"><label>Email</label><input id="authFirst" type="email" placeholder="you@studio.com" autocomplete="username"></div>
    <div class="field"><label>Пароль</label><input id="authPass" type="password" placeholder="${isLogin ? 'пароль' : 'минимум 8 символов'}"></div>
    ${isLogin ? '' : '<div class="field"><label>Лицензионный ключ <span class="opt">(если есть)</span></label><input id="authKey" placeholder="SLATE-XXXX-XXXX-XXXX-XXXX"></div>'}
    <div class="autherr" id="authErr"></div>
    <button class="btn primary authbtn" data-act="${isLogin ? 'do-login' : 'do-register'}">${isLogin ? 'Войти' : 'Создать аккаунт'}</button>
    <div class="authswitch">${isLogin
      ? 'Нет аккаунта? <span class="lnk" data-act="show-register">Создать</span>'
      : 'Уже есть аккаунт? <span class="lnk" data-act="show-login">Войти</span>'}</div>
  </div></div>`;
}
function keyFormHtml() {
  return `<div class="auth"><div class="authcard">
    <div class="authbrand">Slate</div>
    <div class="authttl">Привяжите лицензию</div>
    <p class="authtext">Введите лицензионный ключ, чтобы активировать это устройство.</p>
    <div class="field"><label>Лицензионный ключ</label><input id="authFirst" placeholder="SLATE-XXXX-XXXX-XXXX-XXXX"></div>
    <div class="autherr" id="authErr"></div>
    <button class="btn primary authbtn" data-act="do-redeem">Активировать</button>
    <div class="authswitch"><span class="lnk" data-act="do-logout">Выйти из аккаунта</span></div>
  </div></div>`;
}
function noticeHtml(title, text, label, act) {
  return `<div class="auth"><div class="authcard">
    <div class="authbrand">Slate</div>
    <div class="authttl">${title}</div>
    <p class="authtext">${text}</p>
    <button class="btn primary authbtn" data-act="${act}">${label}</button>
    <div class="authswitch"><span class="lnk" data-act="do-logout">Выйти из аккаунта</span></div>
  </div></div>`;
}

function showAuth(mode) {
  document.body.classList.add('noauth');
  document.getElementById('rail').innerHTML = '';
  const view = document.getElementById('view');
  if (mode === 'login' || mode === 'register') view.innerHTML = authFormHtml(mode);
  else if (mode === 'key') view.innerHTML = keyFormHtml();
  else if (mode === 'devicelimit') view.innerHTML = noticeHtml('Лимит устройств',
    'Эта лицензия уже активна на другом устройстве. Деактивируйте её там (в Slate на старом устройстве — «Выйти»), затем нажмите «Повторить».', 'Повторить', 'retry');
  else if (mode === 'offline') view.innerHTML = noticeHtml('Нет связи с сервером',
    'Не удалось подтвердить лицензию. Проверьте интернет и повторите.', 'Повторить', 'retry');
  const f = document.getElementById('authFirst'); if (f) f.focus();
}

async function doAuth(mode, btn) {
  const email = val('authFirst'), pass = val('authPass'), key = val('authKey');
  const err = document.getElementById('authErr'); if (err) err.textContent = '';
  if (!email || !pass) { if (err) err.textContent = 'Заполните email и пароль'; return; }
  if (mode === 'register' && pass.length < 8) { if (err) err.textContent = 'Пароль минимум 8 символов'; return; }
  btn.disabled = true; const t = btn.textContent; btn.textContent = '…';
  let r;
  try { r = mode === 'login' ? await window.api.authLogin(email, pass) : await window.api.authSignup(email, pass, key); }
  catch (e) { r = { ok: false, error: 'сеть недоступна' }; }
  btn.disabled = false; btn.textContent = t;
  if (r && r.ok) return route();
  if (err) err.textContent = (r && r.error) || 'Не удалось войти';
}
async function doRedeem(btn) {
  const key = val('authFirst'); const err = document.getElementById('authErr'); if (err) err.textContent = '';
  if (!key) { if (err) err.textContent = 'Введите ключ'; return; }
  btn.disabled = true; const t = btn.textContent; btn.textContent = '…';
  let r; try { r = await window.api.authRedeem(key); } catch (e) { r = { ok: false, error: 'сеть недоступна' }; }
  btn.disabled = false; btn.textContent = t;
  if (r && r.ok) return route();
  if (err) err.textContent = (r && r.error) || 'Не удалось привязать ключ';
}
async function doLogout() {
  try { await window.api.authLogout(); } catch (e) { /* noop */ }
  AUTH = null;
  route();
}

/* ---------------- router ---------------- */
async function route() {
  let st; try { st = await window.api.authState(); } catch (e) { st = { authed: false }; }
  AUTH = st;
  if (!st.authed) return showAuth('login');
  if (!st.license || !st.license.valid) {
    let r; try { r = await window.api.licenseEnsure(); } catch (e) { r = { ok: false, code: 'offline' }; }
    if (r && r.ok) { AUTH.license = r.license; return startApp(); }
    if (r && r.code === 'no_license') return showAuth('key');
    if (r && r.code === 'device_limit') return showAuth('devicelimit');
    if (r && r.code === 'offline') return showAuth('offline');
    return showAuth('login'); // сессия истекла/битая
  }
  return startApp();
}
async function refreshLicense() {
  try { const r = await window.api.licenseEnsure(); if (r && r.ok && AUTH) AUTH.license = r.license; } catch (e) { /* noop */ }
}

/* ---------------- запуск приложения ---------------- */
async function startApp() {
  document.body.classList.remove('noauth');
  HOSTS = await window.api.getHosts();
  CATALOG = await window.api.getCatalog();
  try { const s = await window.api.cepStatus(); cepEnabled = !!(s && s.enabled); } catch (e) { /* нет данных */ }
  buildRail();
  select(HOSTS.length ? ('host:' + HOSTS[0].id) : 'account');
  applyRailBadges();
  if (!appStarted) {
    appStarted = true;
    lastCheck = Date.now();
    setTimeout(autoCheck, 1500);
    setInterval(autoCheck, 20 * 60 * 1000);
    setInterval(refreshLicense, 30 * 60 * 1000);
    window.addEventListener('focus', () => { if (Date.now() - lastCheck > 5 * 60 * 1000) autoCheck(); });
  }
}

/* ---------------- слушатели (один раз) ---------------- */
document.getElementById('rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]'); if (b) select(b.dataset.v);
});
(function () {
  const view = document.getElementById('view');
  view.addEventListener('click', onViewClick);
  view.addEventListener('input', (e) => { if (e.target.id === 'searchInput') { searchQuery = e.target.value; renderHostCards(); } });
  view.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = view.querySelector('.authbtn'); if (b) { e.preventDefault(); b.click(); } } });
})();
window.api.onInstallProgress((d) => onInstallProgress(d.scriptId, d.percent));

route();
