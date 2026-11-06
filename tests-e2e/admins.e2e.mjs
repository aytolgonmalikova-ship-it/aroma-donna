// Сквозные тесты страницы «Администраторы» (крупный блок 1): настоящая страница в браузере Chrome
// с Firebase Emulator (Auth + Firestore) и настоящими правилами firestore.rules.
//
// Запуск: npm run test:e2e
// (= firebase emulators:exec --only auth,firestore --project demo-aroma-donna "node --test tests-e2e/admins.e2e.mjs")
// Нужны Java 21+ и Google Chrome (путь — CHROME_PATH, по умолчанию стандартный путь macOS).
//
// Безопасность: только эмуляторы и demo-проект. Ключи рабочего проекта затираются в окружении до запуска Vite,
// поэтому рабочий Firebase не подключится даже без файла .env.emulator; перед запуском браузера проверяется,
// что сервер отдаёт настройки тестового режима. Тестовые данные — tests-emulator/seed-reviews.mjs.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const PROJECT = 'demo-aroma-donna';
const PORT = 5175;
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = 'http://127.0.0.1:9099';
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USERS = {
  owner: { email: 'admin@test.local', password: 'admin-test-123' },
  manager: { email: 'manager@test.local', password: 'manager-test-123' },
  candidate: { email: 'candidate@test.local', password: 'candidate-test-123' },
  customer: { email: 'user@test.local', password: 'user-test-123' },
};
const dict = (lang) => JSON.parse(readFileSync(join(ROOT, `src/locales/${lang}/translation.json`), 'utf8'));
const ru = dict('ru').admin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Окружение: только эмуляторы ----------

process.env.VITE_USE_EMULATORS = 'true';
for (const key of [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_EMAILJS_SERVICE_ID', 'VITE_EMAILJS_TEMPLATE_ID', 'VITE_EMAILJS_PUBLIC_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
]) {
  process.env[key] = ''; // переменные окружения важнее файлов .env — ключи рабочего проекта не попадут в код
}

let vite;
let chrome;
let profileDir;
let cdp;
const uids = {};

// ---------- Данные эмулятора (служебный доступ, только для заполнения и проверки) ----------

function seed() {
  const r = spawnSync(process.execPath, [join(ROOT, 'tests-emulator/seed-reviews.mjs')], { encoding: 'utf8', cwd: ROOT, env: process.env });
  assert.equal(r.status, 0, `seed-reviews.mjs:\n${r.stdout}\n${r.stderr}`);
}

async function uidOf({ email, password }) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  assert.ok(body.localId, `нет пользователя ${email}`);
  return body.localId;
}

async function reseed() {
  seed();
  for (const [role, cred] of Object.entries(USERS)) uids[role] = await uidOf(cred);
}

/** Документ эмулятора: { поле: значение } или null */
async function readDoc(path) {
  const res = await fetch(`${DOCS}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  const { fields = {} } = await res.json();
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, 'nullValue' in v ? null : Object.values(v)[0]]));
}

// ---------- Chrome DevTools Protocol (без пакетов) ----------

async function stopChrome() {
  try {
    cdp?.ws.close();
  } catch {
    /* уже закрыт */
  }
  // Сначала дождаться выхода Chrome — иначе он ещё пишет во временный профиль
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((r) => chrome.once('exit', r));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  chrome = null;
  cdp = null;
  profileDir = null;
}

// Headless Chrome перестаёт отвечать после ~16–20 открытых и закрытых контекстов с тяжёлой страницей:
// перезапускаем его каждые CONTEXTS_PER_CHROME контекстов (на проверки это не влияет)
const CONTEXTS_PER_CHROME = 6;
let contextsOpened = 0;

async function restartChrome() {
  await stopChrome();
  cdp = await connectChrome();
  contextsOpened = 0;
}

async function connectChrome() {
  profileDir = mkdtempSync(join(tmpdir(), 'aroma-e2e-'));
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profileDir}`, '--remote-debugging-port=9335', 'about:blank'], { stdio: 'ignore' });
  let info;
  for (let i = 0; i < 60 && !info; i++) {
    try {
      info = await (await fetch('http://127.0.0.1:9335/json/version')).json();
    } catch {
      await sleep(200);
    }
  }
  assert.ok(info, 'Chrome не запустился');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  // У каждой команды — тайм-аут: если страница перезагрузилась и ответа нет, тест падает, а не зависает
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`${method}: нет ответа браузера за 20 с`));
      }, 20000);
      pending.set(i, (d) => {
        clearTimeout(timer);
        if (d.error) reject(new Error(`${method}: ${d.error.message}`));
        else resolve(d.result);
      });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, send };
}

/**
 * Перед тестом, который держит открытыми несколько вкладок сразу: если плановый перезапуск Chrome
 * пришёлся бы на середину (и закрыл уже открытую вкладку), перезапустить заранее
 */
async function reserveContexts(n) {
  if (contextsOpened + n > CONTEXTS_PER_CHROME) await restartChrome();
}

/** Новая изолированная вкладка (отдельный контекст: свой вход, своё хранилище) под указанной ролью */
async function openAs(role, options = {}) {
  if (contextsOpened >= CONTEXTS_PER_CHROME) await restartChrome();
  try {
    contextsOpened += 1;
    return await openPage(role, options);
  } catch (err) {
    // Браузер перестал отвечать или стенд не загрузился — один раз перезапускаем и повторяем;
    // проверки страницы те же
    if (!/нет ответа браузера|стенд загрузился/.test(err.message)) throw err;
    await restartChrome();
    contextsOpened += 1;
    return openPage(role, options);
  }
}

async function openPage(role, { lang = 'ru', theme = 'light', width = 1100, readyTimeout = 30000, path = null, mode = null, preload = null } = {}) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  if (preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: preload }); // например, корзина в localStorage
  // role = null — весь сайт без автоматического входа (mode=site)
  const qs = role
    ? new URLSearchParams({ ...USERS[role], lang, theme, ...(mode ? { mode } : path ? { mode: 'app', path } : {}) })
    : new URLSearchParams({ mode: 'site', path: path || '/', lang, theme });
  await send('Page.navigate', { url: `${BASE}/tests-e2e/admins-harness.html?${qs}` });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, what, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        // Boolean(...): DOM-элемент нельзя вернуть по значению — только true/false
        if (await evaluate(`Boolean(${expression})`)) return;
      } catch {
        /* страница ещё загружается */
      }
      await sleep(100);
    }
    const body = await evaluate('document.body?.innerText?.slice(0, 600) || ""').catch(() => '');
    throw new Error(`не дождались: ${what}\n--- страница:\n${body}`);
  };
  const page = {
    evaluate,
    waitFor,
    text: () => evaluate('document.body.innerText'),
    count: (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`),
    /** Нажать кнопку, содержащую текст (внутри scope); disabled — ошибка */
    click: async (label, scope = 'body') => {
      const r = await evaluate(`(() => {
        const b = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((x) => x.textContent.includes(${JSON.stringify(label)}) || x.getAttribute('aria-label')?.includes(${JSON.stringify(label)}));
        if (!b) return 'нет кнопки';
        if (b.disabled) return 'кнопка заблокирована';
        b.click();
        return 'ok';
      })()`);
      assert.equal(r, 'ok', `${label}: ${r}`);
    },
    isDisabled: (label, scope = 'body') =>
      evaluate(`[...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((x) => x.textContent.includes(${JSON.stringify(label)}))?.disabled ?? null`),
    /** Ввести значение в поле React (через нативный setter и событие input) */
    type: (selector, value) =>
      evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`),
    close: () => cdp.send('Target.disposeBrowserContext', { browserContextId }),
    /** Набор текста с клавиатуры в поле с фокусом (событие input с inputType insertText, как при наборе) */
    insertText: async (text) => {
      for (const ch of text) await send('Input.insertText', { text: ch });
    },
    /** Нажатие клавиши (как с клавиатуры): Backspace, Delete, Tab, Escape; shift — с Shift (Shift+Tab) */
    press: async (key, { shift = false } = {}) => {
      const code = { Backspace: 8, Delete: 46, Tab: 9, Escape: 27, Enter: 13 }[key];
      const modifiers = shift ? 8 : 0;
      const text = key === 'Enter' ? { text: '\r' } : {};
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers, ...(type === 'keyDown' ? text : {}) });
    },
    /** Нажатие мышью в точке окна (на своей странице стенда): pointerdown, mousedown, mouseup, click */
    mouse: async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    },
    /** Снимок области страницы (PNG, координаты страницы в CSS-пикселях — не зависят от прокрутки) */
    screenshot: async (clip) => Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true })).data, 'base64'),
    /** Ширина окна без перезагрузки страницы */
    resize: (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 768 }),
  };
  await waitFor('window.__e2eReady === true', 'стенд загрузился', readyTimeout);
  return page;
}

const ready = (page) => page.waitFor("document.querySelector('.admin-admins') && !document.querySelector('.admin-admins .spinner, .admin-admins [role=status].spinner') && !document.body.innerText.includes(" + JSON.stringify(ru.admins.loading) + ')', 'страница загрузилась');
const ownerListReady = (page, n) => page.waitFor(`document.querySelectorAll('.admin-member').length === ${n}`, `${n} карточек администраторов`);
const dialogOpen = (page) => page.waitFor("document.querySelector('.admin-confirm-dialog')", 'окно подтверждения');
const dialogClosed = (page) => page.waitFor("!document.querySelector('.admin-confirm-dialog')", 'окно закрылось');
const checkUnderstood = (page) => page.evaluate("document.querySelector('.admin-confirm-dialog input[type=checkbox]').click() || true");

// ---------- Подготовка ----------

before(async () => {
  // Только эмуляторы этого проекта
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'запускайте через npm run test:e2e');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099', 'запускайте через npm run test:e2e');
  assert.ok(existsSync(CHROME), `не найден Chrome: ${CHROME} (укажите CHROME_PATH)`);
  const { createServer } = await import('vite');
  // API заказов (C3.3, этапы 4–5) — тестовый плагин только этого сервера: эмуляторы, Telegram подменён
  const { orderApiE2E } = await import('./orderApiPlugin.mjs');
  vite = await createServer({ root: ROOT, mode: 'emulator', logLevel: process.env.E2E_VITE_LOG || 'error', plugins: [orderApiE2E()], server: { host: '127.0.0.1', port: PORT, strictPort: true, open: false } });
  await vite.listen();
  // Сервер отдаёт именно тестовый режим: флаг включён, ключи рабочего проекта пусты
  const fb = await (await fetch(`${BASE}/src/services/firebase.js`)).text();
  assert.match(fb, /"VITE_USE_EMULATORS":\s*"true"/, 'сервер не в тестовом режиме — остановка');
  assert.match(fb, /"VITE_FIREBASE_PROJECT_ID":\s*""/, 'в коде есть ключ рабочего проекта — остановка');
  assert.match(fb, /"VITE_FIREBASE_API_KEY":\s*""/, 'в коде есть ключ рабочего проекта — остановка');
  cdp = await connectChrome();
  await reseed();
  // Прогрев: при первом открытии Vite оптимизирует зависимости и может перезагрузить страницу
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const warm = await openAs('customer', { readyTimeout: 60000 });
      await warm.waitFor("document.querySelector('.admin-gate')", 'прогрев', 60000);
      await warm.close();
      break;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
});

after(async () => {
  await stopChrome();
  await vite?.close();
});

// ---------- Доступ ----------

describe('страница «Администраторы»: разделение полномочий', () => {
  test('покупатель не открывает раздел и видит только свой UID на экране «Нет доступа»', async () => {
    const page = await openAs('customer');
    await page.waitFor("document.querySelector('.admin-gate')", 'экран «Нет доступа»');
    const text = await page.text();
    assert.ok(text.includes(ru.deniedTitle));
    assert.equal(await page.evaluate("document.querySelector('.admin-gate__uid-value').textContent"), uids.customer);
    for (const other of ['owner', 'manager', 'candidate']) assert.ok(!text.includes(uids[other]), `чужой UID: ${other}`);
    assert.equal(await page.count('.admin-admins'), 0);
    await page.close();
  });

  test('обычный администратор: нет списка, формы и действий — только сообщение «Только для главного администратора»', async () => {
    const page = await openAs('manager');
    await ready(page);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.access.ownerOnlyTitle)})`, 'сообщение для обычного администратора');
    assert.equal(await page.count('.admin-member'), 0);
    assert.equal(await page.count('.admin-grant'), 0);
    assert.equal(await page.count('.admin-transfer'), 0);
    const html = await page.evaluate('document.body.innerHTML');
    for (const other of ['owner', 'candidate', 'customer']) assert.ok(!html.includes(uids[other]), `виден UID: ${other}`);
    await page.close();
  });

  test('владелец: список (владелец первым), кандидат отмечен, исходящее предложение, причины запрета отзыва', async () => {
    const page = await openAs('owner');
    await ready(page);
    await ownerListReady(page, 3);
    const cards = await page.evaluate("[...document.querySelectorAll('.admin-member')].map((c) => c.className)");
    assert.match(cards[0], /admin-member--owner/);
    assert.equal(cards.filter((c) => /admin-member--pending/.test(c)).length, 1);
    const text = await page.text();
    assert.ok(text.includes(ru.admins.transfer.outgoingTitle));
    assert.ok(text.includes(uids.candidate) && text.includes(uids.manager) && text.includes(uids.owner));
    assert.ok(text.includes(ru.admins.revoke.blocked.self) && text.includes(ru.admins.revoke.blocked.pending));
    // Пока предложение действует, новые предложения не показываются
    assert.equal(await page.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.includes(${JSON.stringify(ru.admins.transfer.offerAction)})).length`), 0);
    assert.equal(await page.count('.admin-grant'), 1);
    await page.close();
  });
});

// ---------- Действия владельца ----------

describe('страница «Администраторы»: действия владельца', () => {
  test('отмена предложения и новое предложение через окно подтверждения; данные обновляются', async () => {
    await reseed();
    const page = await openAs('owner');
    await ready(page);
    await ownerListReady(page, 3);
    await page.click(ru.admins.transfer.cancelAction, '.admin-transfer--outgoing');
    await page.waitFor("!document.querySelector('.admin-transfer--outgoing')", 'предложение снято');
    assert.equal((await readDoc('adminConfig/primary')).pendingOwnerUid, null);
    // Предложить роль менеджеру: подтверждение обязательно
    await page.click(ru.admins.transfer.offerActionLabel.replace('{{name}}', 'Менеджер (тест)'));
    await dialogOpen(page);
    assert.equal(await page.isDisabled(ru.admins.transfer.offerConfirm, '.admin-confirm-dialog'), true, 'без флажка нельзя');
    await checkUnderstood(page);
    await page.click(ru.admins.transfer.offerConfirm, '.admin-confirm-dialog');
    await dialogClosed(page);
    await page.waitFor("document.querySelector('.admin-transfer--outgoing')", 'новое исходящее предложение');
    assert.equal((await readDoc('adminConfig/primary')).pendingOwnerUid, uids.manager);
    await page.close();
  });

  test('добавление: проверка формата, несуществующий пользователь, успех, повторное назначение', async () => {
    await reseed();
    const page = await openAs('owner');
    await ready(page);
    await ownerListReady(page, 3);
    // Неверный формат — ошибка у поля, запроса нет
    await page.type('#admin-grant-uid', 'bad uid!');
    await page.click(ru.admins.grant.submit, '.admin-grant');
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.uid.invalid)})`, 'ошибка формата UID');
    // Пустой UID
    await page.type('#admin-grant-uid', '   ');
    await page.click(ru.admins.grant.submit, '.admin-grant');
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.uid.required)})`, 'UID обязателен');
    // Несуществующий пользователь
    await page.type('#admin-grant-uid', 'ghostUid1234567890');
    await page.click(ru.admins.grant.submit, '.admin-grant');
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.errors['user-not-found'])})`, 'user-not-found');
    assert.equal(await readDoc('admins/ghostUid1234567890'), null);
    // Покупатель — успешно, с подписью. Сначала дождаться, пока форма снова доступна: сообщение об ошибке
    // появляется раньше, чем форма снимает блокировку после ответа (кнопка заблокирована, пока идёт запрос)
    await page.waitFor("![...document.querySelectorAll('.admin-grant button, .admin-grant input')].some((x) => x.disabled)", 'форма снова доступна');
    await page.type('#admin-grant-uid', uids.customer);
    await page.type('#admin-grant-label', '  Сестра  ');
    await page.click(ru.admins.grant.submit, '.admin-grant');
    await ownerListReady(page, 4);
    await page.waitFor("document.querySelector('#admin-grant-uid').value === ''", 'форма очищена');
    const saved = await readDoc(`admins/${uids.customer}`);
    assert.equal(saved.label, 'Сестра');
    assert.equal(saved.grantedBy, uids.owner);
    assert.ok((await page.text()).includes('Сестра'));
    // Повторное назначение
    await page.waitFor("![...document.querySelectorAll('.admin-grant button, .admin-grant input')].some((x) => x.disabled)", 'форма снова доступна');
    await page.type('#admin-grant-uid', uids.customer);
    await page.click(ru.admins.grant.submit, '.admin-grant');
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.errors['already-admin'])})`, 'already-admin');
    await page.close();
  });

  test('отзыв доступа через окно подтверждения: блокировка до флажка, затем список обновлён', async () => {
    const page = await openAs('owner');
    await ready(page);
    await ownerListReady(page, 4); // после предыдущего теста: + покупатель «Сестра»
    await page.click(ru.admins.revoke.actionLabel.replace('{{name}}', 'Сестра'));
    await dialogOpen(page);
    assert.ok((await page.evaluate("document.querySelector('.admin-confirm-dialog').innerText")).includes(uids.customer), 'видно, у кого отзывается доступ');
    assert.equal(await page.isDisabled(ru.admins.revoke.confirm, '.admin-confirm-dialog'), true);
    await checkUnderstood(page);
    await page.click(ru.admins.revoke.confirm, '.admin-confirm-dialog');
    await dialogClosed(page);
    await ownerListReady(page, 3);
    assert.equal(await readDoc(`admins/${uids.customer}`), null);
    await page.close();
  });
});

// ---------- Кандидат ----------

describe('страница «Администраторы»: кандидат', () => {
  test('кандидат видит входящее предложение и отклоняет его', async () => {
    await reseed();
    const page = await openAs('candidate');
    await ready(page);
    await page.waitFor("document.querySelector('.admin-transfer--incoming')", 'входящее предложение');
    assert.equal(await page.count('.admin-member'), 0, 'кандидат не видит список');
    assert.equal(await page.count('.admin-grant'), 0);
    await page.click(ru.admins.transfer.declineAction, '.admin-transfer--incoming');
    await page.waitFor("!document.querySelector('.admin-transfer--incoming')", 'предложение исчезло');
    assert.equal((await readDoc('adminConfig/primary')).pendingOwnerUid, null);
    await page.close();
  });

  test('кандидат принимает роль сам; прежний владелец становится обычным администратором', async () => {
    await reseed();
    const page = await openAs('candidate');
    await ready(page);
    await page.waitFor("document.querySelector('.admin-transfer--incoming')", 'входящее предложение');
    await page.click(ru.admins.transfer.acceptAction, '.admin-transfer--incoming');
    await dialogOpen(page);
    assert.equal(await page.isDisabled(ru.admins.transfer.acceptConfirm, '.admin-confirm-dialog'), true);
    await checkUnderstood(page);
    await page.click(ru.admins.transfer.acceptConfirm, '.admin-confirm-dialog');
    await dialogClosed(page);
    await ownerListReady(page, 3); // теперь он владелец и видит список
    const cfg = await readDoc('adminConfig/primary');
    assert.equal(cfg.ownerUid, uids.candidate);
    assert.equal(cfg.previousOwnerUid, uids.owner);
    assert.equal(cfg.pendingOwnerUid, null);
    await page.close();
    // Прежний владелец: панель открывается, но управление закрыто
    const old = await openAs('owner');
    await ready(old);
    await old.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.access.ownerOnlyTitle)})`, 'прежний владелец — обычный администратор');
    assert.equal(await old.count('.admin-member'), 0);
    assert.ok(await readDoc(`admins/${uids.owner}`), 'документ прежнего владельца сохранён');
    await old.close();
  });

  test('ошибка: предложение отменили, пока кандидат держал окно открытым — понятное сообщение, кнопка заблокирована', async () => {
    await reseed();
    const page = await openAs('candidate');
    await ready(page);
    await page.waitFor("document.querySelector('.admin-transfer--incoming')", 'входящее предложение');
    await page.click(ru.admins.transfer.acceptAction, '.admin-transfer--incoming');
    await dialogOpen(page);
    // Тем временем владелец отменяет предложение в другой вкладке
    const owner = await openAs('owner');
    await ready(owner);
    await owner.waitFor("document.querySelector('.admin-transfer--outgoing')", 'исходящее предложение');
    await owner.click(ru.admins.transfer.cancelAction, '.admin-transfer--outgoing');
    await owner.waitFor("!document.querySelector('.admin-transfer--outgoing')", 'отменено');
    await owner.close();
    await checkUnderstood(page);
    await page.click(ru.admins.transfer.acceptConfirm, '.admin-confirm-dialog');
    await page.waitFor(`document.querySelector('.admin-confirm-dialog')?.innerText.includes(${JSON.stringify(ru.admins.errors['no-offer'])})`, 'сообщение no-offer');
    assert.equal(await page.isDisabled(ru.admins.transfer.acceptConfirm, '.admin-confirm-dialog'), true, 'повторить нельзя');
    assert.equal((await readDoc('adminConfig/primary')).ownerUid, uids.owner, 'роль не перешла');
    await page.click(ru.admins.dialog.cancel, '.admin-confirm-dialog');
    await dialogClosed(page);
    await page.waitFor("!document.querySelector('.admin-transfer--incoming')", 'данные обновлены: предложения нет');
    await page.close();
  });
});

// ---------- Языки, темы, ширина ----------

describe('страница «Администраторы»: три языка, светлая и тёмная темы, узкий экран', () => {
  for (const lang of ['ru', 'ky', 'en']) {
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 768]) {
        test(`${lang}, ${theme}, ${width}px: все тексты переведены, страница и окно не шире экрана`, async () => {
          await reseed();
          const t = dict(lang).admin;
          const page = await openAs('owner', { lang, theme, width });
          await ready(page);
          await ownerListReady(page, 3);
          assert.equal(await page.evaluate('document.documentElement.dataset.theme'), theme);
          const text = await page.text();
          assert.doesNotMatch(text, /admin\.(admins|nav)\./, 'непереведённые ключи');
          assert.ok(text.includes(t.admins.grant.title) && text.includes(t.admins.transfer.outgoingTitle), lang);
          const overflow = () =>
            page.evaluate(`(() => {
              const vw = innerWidth; const bad = [];
              for (const el of document.querySelectorAll('.admin-admins *, .admin-confirm-dialog *')) {
                const r = el.getBoundingClientRect();
                if (r.width && (r.right > vw + 0.5 || r.left < -0.5) && !el.closest('.visually-hidden')) bad.push(el.tagName + '.' + el.className);
              }
              return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 5) };
            })()`);
          let o = await overflow();
          assert.ok(o.sw <= o.vw, `страница шире экрана: ${o.sw} > ${o.vw}`);
          assert.deepEqual(o.bad, []);
          // Окно отзыва доступа
          await page.click(t.admins.revoke.actionLabel.replace('{{name}}', 'Менеджер (тест)'));
          await dialogOpen(page);
          assert.doesNotMatch(await page.evaluate("document.querySelector('.admin-confirm-dialog').innerText"), /admin\.admins\./);
          o = await overflow();
          assert.deepEqual(o.bad, []);
          await page.close();
        });
      }
    }
  }

  for (const lang of ['ky', 'en']) {
    test(`${lang}: экран «Нет доступа» с UID переведён`, async () => {
      const t = dict(lang).admin;
      const page = await openAs('customer', { lang });
      await page.waitFor("document.querySelector('.admin-gate')", 'экран «Нет доступа»');
      const text = await page.text();
      assert.ok(text.includes(t.deniedTitle) && text.includes(t.deniedUidLabel) && text.includes(uids.customer), lang);
      await page.close();
    });
  }
});

// ---------- Блок 2: меню и маршруты админ-панели ----------

const menuLinks = (page) => page.evaluate("[...document.querySelectorAll('.admin__nav a')].map((a) => a.getAttribute('href'))");
const h1 = (page) => page.evaluate("document.querySelector('.admin__main h1')?.textContent ?? ''");
const panelReady = (page) => page.waitFor("document.querySelector('.admin__nav') && document.querySelector('.admin__main h1')", 'админ-панель открылась');
const SECTION_ROUTES = [
  ['/admin/orders', ru.nav.orders],
  ['/admin/products', ru.nav.products],
  ['/admin/customers', ru.nav.customers],
  ['/admin/reviews', ru.nav.reviews],
];

describe('Блок 2: раздел «Администраторы» в меню и маршрутах', () => {
  test('владелец: пункт меню есть, переход по нему открывает страницу со списком и действиями', async () => {
    await reseed();
    const page = await openAs('owner', { path: '/admin' });
    await panelReady(page);
    await page.waitFor("document.querySelector('.admin__nav a[href=\"/admin/admins\"]')", 'пункт меню «Администраторы»');
    assert.ok((await page.text()).includes(ru.nav.admins));
    await page.evaluate("document.querySelector('.admin__nav a[href=\"/admin/admins\"]').click() || true");
    await page.waitFor("window.__e2ePath === '/admin/admins'", 'переход на /admin/admins');
    await ownerListReady(page, 3);
    assert.equal(await page.count('.admin-grant'), 1);
    assert.equal(await page.evaluate("document.querySelector('.admin__nav a[href=\"/admin/admins\"]').classList.contains('active')"), true);
    await page.close();
  });

  test('владелец: прямой переход по адресу и все функции (назначение и отзыв) работают внутри панели', async () => {
    const page = await openAs('owner', { path: '/admin/admins' });
    await panelReady(page);
    await ownerListReady(page, 3);
    await page.type('#admin-grant-uid', uids.customer);
    await page.click(ru.admins.grant.submit, '.admin-grant');
    await ownerListReady(page, 4);
    assert.ok(await readDoc(`admins/${uids.customer}`));
    await page.click(ru.admins.revoke.actionLabel.replace('{{name}}', uids.customer.slice(0, 6)));
    await dialogOpen(page);
    await checkUnderstood(page);
    await page.click(ru.admins.revoke.confirm, '.admin-confirm-dialog');
    await dialogClosed(page);
    await ownerListReady(page, 3);
    assert.equal(await readDoc(`admins/${uids.customer}`), null);
    await page.close();
  });

  test('обычный администратор: пункта меню нет; прямой адрес — сообщение без страницы; другие разделы работают', async () => {
    const page = await openAs('manager', { path: '/admin' });
    await panelReady(page);
    await sleep(300); // роль загружена: меню больше не меняется
    assert.ok(!(await menuLinks(page)).includes('/admin/admins'));
    assert.ok(!(await page.text()).includes(ru.nav.admins), 'и в меню, и на главной');
    await page.close();
    const direct = await openAs('manager', { path: '/admin/admins' });
    await panelReady(direct);
    await direct.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.admins.access.ownerOnlyTitle)})`, 'сообщение «Только для главного администратора»');
    assert.equal(await direct.count('.admin-grant'), 0);
    assert.equal(await direct.count('.admin-member'), 0);
    const html = await direct.evaluate('document.body.innerHTML');
    for (const other of ['owner', 'candidate', 'customer']) assert.ok(!html.includes(uids[other]), `виден UID: ${other}`);
    await direct.close();
    for (const [path, title] of SECTION_ROUTES) {
      const p = await openAs('manager', { path });
      await panelReady(p);
      await p.waitFor(`document.querySelector('.admin__main h1')?.textContent === ${JSON.stringify(title)}`, `${path}: заголовок`);
      await p.close();
    }
  });

  test('кандидат: пункта меню нет; на главной — уведомление со ссылкой; принятие роли добавляет пункт меню', async () => {
    await reseed();
    const page = await openAs('candidate', { path: '/admin' });
    await panelReady(page);
    await page.waitFor("document.querySelector('.admin-transfer--incoming')", 'уведомление о предложении на главной');
    assert.ok(!(await menuLinks(page)).includes('/admin/admins'));
    assert.ok((await page.text()).includes(uids.owner.slice(0, 6)), 'видно, от кого предложение');
    // «Открыть предложение» — ссылка (Link), а не кнопка
    assert.equal(await page.evaluate("document.querySelector('.admin-transfer--incoming a[href=\"/admin/admins\"]')?.textContent"), ru.admins.transfer.openOffer);
    await page.evaluate("document.querySelector('.admin-transfer--incoming a[href=\"/admin/admins\"]').click() || true");
    await page.waitFor("window.__e2ePath === '/admin/admins'", 'переход к предложению');
    await page.waitFor("document.querySelector('.admin__main .admin-admins .admin-transfer--incoming')", 'предложение на странице');
    assert.equal(await page.count('.admin-member'), 0);
    await page.click(ru.admins.transfer.acceptAction, '.admin-admins .admin-transfer--incoming');
    await dialogOpen(page);
    await checkUnderstood(page);
    await page.click(ru.admins.transfer.acceptConfirm, '.admin-confirm-dialog');
    await dialogClosed(page);
    await ownerListReady(page, 3);
    // Роль обновилась без перезагрузки: пункт меню появился
    await page.waitFor("document.querySelector('.admin__nav a[href=\"/admin/admins\"]')", 'пункт меню у нового владельца');
    assert.equal((await readDoc('adminConfig/primary')).ownerUid, uids.candidate);
    await page.close();
    // Прежний владелец: пункта меню больше нет
    const old = await openAs('owner', { path: '/admin' });
    await panelReady(old);
    await sleep(300);
    assert.ok(!(await menuLinks(old)).includes('/admin/admins'));
    await old.close();
  });

  test('покупатель: прямой адрес раздела — экран «Нет доступа» со своим UID, без меню', async () => {
    const page = await openAs('customer', { path: '/admin/admins' });
    await page.waitFor("document.querySelector('.admin-gate')", 'экран «Нет доступа»');
    assert.equal(await page.count('.admin__nav'), 0);
    assert.equal(await page.count('.admin-admins'), 0);
    assert.equal(await page.evaluate("document.querySelector('.admin-gate__uid-value').textContent"), uids.customer);
    await page.close();
  });

  test('владелец: остальные разделы и маршруты открываются как раньше; неизвестный адрес ведёт на главную', async () => {
    await reseed();
    for (const [path, title] of SECTION_ROUTES) {
      const p = await openAs('owner', { path });
      await panelReady(p);
      await p.waitFor(`document.querySelector('.admin__main h1')?.textContent === ${JSON.stringify(title)}`, `${path}: заголовок`);
      assert.equal(await p.evaluate(`document.querySelector('.admin__nav a[href="${path}"]').classList.contains('active')`), true, path);
      await p.close();
    }
    const home = await openAs('owner', { path: '/admin' });
    await panelReady(home);
    assert.equal(await h1(home), ru.dashboard.title);
    await home.close();
    const unknown = await openAs('owner', { path: '/admin/no-such-section' });
    await unknown.waitFor("window.__e2ePath === '/admin'", 'переадресация на главную');
    await unknown.close();
  });
});

// ---------- Блок 2: вход через Google и «Забыли пароль?» ----------
// Настоящее окно Google OAuth здесь не открывается и не нажимается: логика входа через Google проверена
// в tests/googleAuth.test.js (подставной Firebase) и tests-emulator/authFlows.emulator.js (эмулятор Auth,
// signInWithCredential). Настоящий вход через Google проверяется вручную — docs/GOOGLE_AUTH.md.

const AUTH_ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const t = (lang) => dict(lang).auth;
const path = (page) => page.evaluate('window.__e2ePath');

/** Пользователи эмулятора Auth с этим e-mail: [{ uid, providers }] */
async function authUsersByEmail(email) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
    method: 'POST',
    headers: AUTH_ADMIN,
    body: JSON.stringify({ returnUserInfo: true }),
  });
  const { userInfo = [] } = await res.json();
  return userInfo
    .filter((u) => u.email === email)
    .map((u) => ({ uid: u.localId, providers: (u.providerUserInfo || []).map((p) => p.providerId).sort() }));
}

/** Все пользователи эмулятора Auth (UID) */
async function authUids() {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
    method: 'POST',
    headers: AUTH_ADMIN,
    body: JSON.stringify({ returnUserInfo: true }),
  });
  const { userInfo = [] } = await res.json();
  return userInfo.map((u) => u.localId).sort();
}

/** Письма для смены пароля, «отправленные» эмулятором Auth на этот e-mail */
async function resetCodesFor(email) {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes = [] } = await res.json();
  return oobCodes.filter((c) => c.email === email && c.requestType === 'PASSWORD_RESET');
}

/**
 * Документ появится в Firestore: страница регистрации записывает профиль сразу после создания
 * пользователя в Firebase Auth
 */
async function waitForDoc(docPath, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const data = await readDoc(docPath);
    if (data) return data;
    await sleep(150);
  }
  throw new Error(`нет документа ${docPath}`);
}

/** Ничего на странице не выходит за ширину экрана (внутри selector) */
const overflow = (page, selector) =>
  page.evaluate(`(() => {
    const vw = innerWidth; const bad = [];
    for (const el of document.querySelectorAll(${JSON.stringify(`${selector}, ${selector} *`)})) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) bad.push(el.tagName + '.' + el.className);
    }
    return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 5) };
  })()`);

describe('Блок 2: вход через Google (без настоящего окна Google)', () => {
  test('кнопка Google на входе и регистрации; окно заблокировано браузером — понятное сообщение на текущем языке', async () => {
    await reseed();
    for (const p of ['/login', '/register']) {
      const page = await openAs(null, { path: p });
      await page.waitFor("document.querySelector('.google-btn')", `кнопка Google: ${p}`);
      assert.equal(await page.evaluate("document.querySelector('.google-btn').innerText.trim()"), t('ru').google.continue);
      await page.close();
    }
    // Нажатие из скрипта (не действие пользователя): браузер блокирует окно, Firebase сообщает auth/popup-blocked.
    // Окно Google при этом не открывается
    const page = await openAs(null, { path: '/login', lang: 'en' });
    await page.waitFor("document.querySelector('.google-btn')", 'кнопка Google');
    const usersBefore = await authUids();
    await page.evaluate("document.querySelector('.google-btn').click(), true");
    await page.waitFor(`document.querySelector('.form__error')?.innerText === ${JSON.stringify(t('en').google.popupBlocked)}`, 'сообщение popupBlocked');
    assert.equal(await path(page), '/login');
    assert.equal(await page.evaluate("document.querySelector('.google-btn').disabled"), false, 'можно повторить');
    assert.deepEqual(await authUids(), usersBefore, 'пользователь не создан');
    await page.close();
  });

  test('e-mail и пароль работают как раньше: вход и регистрация; вошедший на /login — сразу в кабинет', async () => {
    const login = await openAs(null, { path: '/login' });
    await login.waitFor("document.querySelector('#login-email')", 'форма входа');
    await login.type('#login-email', USERS.customer.email);
    await login.type('#login-password', USERS.customer.password);
    await login.click(t('ru').loginButton, 'form');
    await login.waitFor("window.__e2ePath === '/account'", 'вход по паролю');
    // Вошедший пользователь на страницах входа и регистрации — сразу в кабинет
    for (const p of ['/login', '/register']) {
      await login.evaluate(`window.__e2eNavigate(${JSON.stringify(p)}), true`);
      await login.waitFor("window.__e2ePath === '/account'", `${p} → кабинет`);
      assert.equal(await login.count('.google-btn'), 0);
    }
    await login.close();
    const reg = await openAs(null, { path: '/register' });
    await reg.waitFor("document.querySelector('#reg-email')", 'форма регистрации');
    await reg.type('#reg-name', 'Новый Покупатель');
    await reg.type('#reg-email', 'new.password.user@example.com');
    await reg.type('#reg-password', 'secret-12345');
    await reg.type('#reg-confirm', 'secret-12345');
    await reg.evaluate("document.querySelector('input[name=agree]').click(), true");
    await reg.click(t('ru').registerButton, 'form');
    await reg.waitFor("window.__e2ePath === '/account'", 'регистрация по паролю');
    const users = await authUsersByEmail('new.password.user@example.com');
    assert.equal(users.length, 1);
    assert.deepEqual(users[0].providers, ['password']);
    assert.equal((await waitForDoc(`users/${users[0].uid}`)).name, 'Новый Покупатель');
    await reg.close();
  });

  for (const lang of ['ru', 'ky', 'en']) {
    for (const theme of ['light', 'dark']) {
      test(`кнопка Google на 320px: ${lang}, ${theme} — переведена, ничего не выходит за экран`, async () => {
        for (const p of ['/login', '/register']) {
          const page = await openAs(null, { path: p, lang, theme, width: 320 });
          await page.waitFor("document.querySelector('.google-btn')", `кнопка Google: ${p}`);
          const text = await page.evaluate("document.querySelector('.google-signin').innerText");
          assert.ok(text.includes(t(lang).google.continue) && text.includes(t(lang).google.consent), `${lang} ${p}`);
          const o = await overflow(page, '.auth-card');
          assert.ok(o.sw <= o.vw, `${p}: страница шире экрана ${o.sw} > ${o.vw}`);
          assert.deepEqual(o.bad, [], p);
          await page.close();
        }
      });
    }
  }
});

describe('Блок 2: «Забыли пароль?»', () => {
  test('ссылка со страницы входа переносит e-mail; неверный адрес — ошибка у поля, письмо не отправлено', async () => {
    await reseed();
    const page = await openAs(null, { path: '/login' });
    await page.waitFor("document.querySelector('#login-email')", 'форма входа');
    await page.type('#login-email', USERS.customer.email);
    await page.evaluate("document.querySelector('.form__forgot a').click(), true");
    await page.waitFor("window.__e2ePath === '/forgot-password'", 'страница восстановления');
    await page.waitFor("document.querySelector('#reset-email')", 'поле e-mail');
    assert.equal(await page.evaluate("document.querySelector('#reset-email').value"), USERS.customer.email, 'e-mail перенесён');
    await page.type('#reset-email', 'не-адрес');
    await page.click(t('ru').reset.submit, 'form');
    await page.waitFor(`document.querySelector('#reset-email-error')?.innerText === ${JSON.stringify(dict('ru').validation.email)}`, 'ошибка у поля');
    assert.equal(await page.count('.reset-sent'), 0);
    assert.deepEqual(await resetCodesFor('не-адрес'), []);
    await page.close();
  });

  test('письмо отправлено: сообщение об успехе; UID, профиль и пользователи не меняются; неизвестный адрес — тот же ответ', async () => {
    const email = USERS.customer.email;
    const profileBefore = await readDoc(`users/${uids.customer}`);
    const usersBefore = await authUids();
    const codesBefore = (await resetCodesFor(email)).length;
    const page = await openAs(null, { path: '/forgot-password' });
    await page.waitFor("document.querySelector('#reset-email')", 'поле e-mail');
    await page.type('#reset-email', `  ${email.toUpperCase()}  `);
    await page.click(t('ru').reset.submit, 'form');
    await page.waitFor("document.querySelector('.reset-sent')", 'сообщение об отправке');
    const text = await page.evaluate("document.querySelector('.reset-sent').innerText");
    assert.ok(text.includes(t('ru').reset.sentTitle) && text.includes(email), text);
    assert.equal((await resetCodesFor(email)).length, codesBefore + 1, 'эмулятор получил одно письмо');
    assert.deepEqual(await authUids(), usersBefore, 'новых пользователей нет');
    assert.deepEqual((await authUsersByEmail(email)).map((u) => u.uid), [uids.customer], 'тот же UID');
    assert.deepEqual(await readDoc(`users/${uids.customer}`), profileBefore, 'профиль не изменён');
    // «Отправить ещё раз» возвращает форму; неизвестный адрес — тот же ответ, письма нет
    await page.click(t('ru').reset.again);
    await page.waitFor("document.querySelector('#reset-email')", 'форма снова');
    await page.type('#reset-email', 'nobody@example.com');
    await page.click(t('ru').reset.submit, 'form');
    await page.waitFor("document.querySelector('.reset-sent')", 'тот же ответ');
    assert.deepEqual(await resetCodesFor('nobody@example.com'), []);
    assert.deepEqual(await authUids(), usersBefore, 'пользователь не создан');
    // «Вернуться ко входу»
    await page.evaluate("document.querySelector('.reset-sent a').click(), true");
    await page.waitFor("window.__e2ePath === '/login'", 'возврат ко входу');
    await page.close();
  });

  for (const lang of ['ru', 'ky', 'en']) {
    test(`«Забыли пароль?» на 320px: ${lang} — переведено, форма и сообщение не выходят за экран`, async () => {
      const page = await openAs(null, { path: '/forgot-password', lang, theme: lang === 'ky' ? 'dark' : 'light', width: 320 });
      await page.waitFor("document.querySelector('#reset-email')", 'поле e-mail');
      const text = await page.text();
      assert.ok(text.includes(t(lang).reset.title) && text.includes(t(lang).reset.submit), lang);
      let o = await overflow(page, '.auth-card');
      assert.ok(o.sw <= o.vw, `форма шире экрана ${o.sw} > ${o.vw}`);
      assert.deepEqual(o.bad, []);
      await page.type('#reset-email', 'very.long.address.for.narrow.screen@example.com');
      await page.click(t(lang).reset.submit, 'form');
      await page.waitFor("document.querySelector('.reset-sent')", 'сообщение');
      assert.ok((await page.text()).includes(t(lang).reset.sentTitle));
      o = await overflow(page, '.auth-card');
      assert.ok(o.sw <= o.vw, `сообщение шире экрана ${o.sw} > ${o.vw}`);
      assert.deepEqual(o.bad, []);
      await page.close();
    });
  }

  test('остальные страницы сайта открываются как раньше', async () => {
    for (const p of ['/', '/catalog', '/reviews', '/cart']) {
      const page = await openAs(null, { path: p });
      await page.waitFor("document.querySelector('main') && document.querySelector('header')", `${p}: страница`);
      assert.equal(await path(page), p);
      await page.close();
    }
  });
});

// ---------- Блок 2: телефон +996 ----------
// Настоящая форма оформления (CheckoutForm) на стенде: набор и удаление — события клавиатуры Chrome,
// вставка — событие paste с буфером обмена, автозаполнение — замена значения (insertReplacementText).
// Отправка формы — настоящие buildOrder и createOrder в эмулятор под тестовым покупателем.

const v = (lang) => dict(lang).validation;
const phone = (page) =>
  page.evaluate(`(() => {
    const el = document.querySelector('#co-phone');
    return { value: el.value, caret: el.selectionStart, error: document.querySelector('#co-phone-error')?.innerText || null, invalid: el.getAttribute('aria-invalid') };
  })()`);
const phoneIs = (page, value) => page.waitFor(`document.querySelector('#co-phone').value === ${JSON.stringify(value)}`, `в поле «${value}»`);
const caretAt = (page, start, end = start) =>
  page.evaluate(`(() => { const el = document.querySelector('#co-phone'); el.focus(); el.setSelectionRange(${start}, ${end}); return true; })()`);
const selectAll = (page) => page.evaluate("(() => { const el = document.querySelector('#co-phone'); el.focus(); el.select(); return true; })()");
const paste = (page, text) =>
  page.evaluate(`(() => {
    const el = document.querySelector('#co-phone');
    el.focus();
    el.select();
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(text)});
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
/** Автозаполнение браузера: значение заменяется целиком */
const autofill = (page, text) =>
  page.evaluate(`(() => {
    const el = document.querySelector('#co-phone');
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    return true;
  })()`);

/** Значение поля Firestore REST → JS (строки, числа, null, списки, словари) */
const fromValue = (val) => {
  if ('mapValue' in val) return Object.fromEntries(Object.entries(val.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromValue);
  if ('nullValue' in val) return null;
  if ('integerValue' in val) return Number(val.integerValue);
  return Object.values(val)[0];
};
const toValue = (x) => {
  if (x === null) return { nullValue: null };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  if (typeof x === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, toValue(y)])) } };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'boolean') return { booleanValue: x };
  return { stringValue: String(x) };
};
async function readFullDoc(docPath) {
  const res = await fetch(`${DOCS}/${docPath}`, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  const { fields = {} } = await res.json();
  return fromValue({ mapValue: { fields } });
}
/** Старый заказ — служебная запись в эмулятор (как будто создан до Блока 2) */
async function writeLegacyOrder(uid, id, customerPhone, createdAt) {
  const data = {
    id,
    userId: uid,
    createdAt,
    items: [{ id: 'p1', name: 'Старый товар', brand: 'B', volume: 50, price: 1000, quantity: 1 }],
    subtotal: 1000,
    discount: 0,
    promoCode: null,
    delivery: 0,
    total: 1000,
    customer: { name: 'Старый', lastName: 'Заказ', phone: customerPhone, email: 'old@example.com' },
    shipping: { method: 'pickup', region: null, city: null, address: null, comment: '' },
    payment: 'cashOnDelivery',
    paymentStatus: 'awaitingPayment',
    mode: 'firebase',
    status: 'new',
  };
  const res = await fetch(`${DOCS}/users/${uid}/orders/${id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toValue(data).mapValue.fields }),
  });
  assert.equal(res.status, 200, `запись ${id}`);
  return data;
}

describe('Блок 2: телефон +996', () => {
  test('набор и удаление: префикс не стирается, 10-я цифра не вводится, 996 в начале сохраняется, курсор на месте', async () => {
    await reseed();
    const page = await openAs('customer', { mode: 'checkout' });
    await page.waitFor("document.querySelector('#co-phone')", 'поле телефона');
    assert.equal(await page.evaluate("document.querySelector('.phone-input__prefix').innerText"), '+996');
    assert.equal((await phone(page)).value, '');
    await caretAt(page, 0);
    await page.insertText('0'); // привычка набирать 0700… — 0 не вводится
    await page.insertText('7001234567');
    await phoneIs(page, '700 123 456');
    assert.deepEqual(await phone(page), { value: '700 123 456', caret: 11, error: null, invalid: 'false' });
    // Полное поле: цифра в середину отклоняется, курсор остаётся на месте
    await caretAt(page, 3);
    await page.insertText('5');
    await sleep(200);
    assert.deepEqual(await phone(page), { value: '700 123 456', caret: 3, error: null, invalid: 'false' });
    await caretAt(page, 11);
    await page.press('Backspace');
    await phoneIs(page, '700 123 45');
    assert.equal((await phone(page)).caret, 10);
    // Backspace сразу после пробела «700 |123 45» — удаляется цифра перед пробелом, курсор не прыгает в конец
    await caretAt(page, 4);
    await page.press('Backspace');
    await phoneIs(page, '701 234 5');
    assert.equal((await phone(page)).caret, 2);
    // Цифра в середину: курсор остаётся после неё
    await page.insertText('0');
    await phoneIs(page, '700 123 45');
    assert.equal((await phone(page)).caret, 3);
    // Backspace в начале поля: префикс на месте, цифры те же
    await caretAt(page, 0);
    await page.press('Backspace');
    await sleep(200);
    assert.equal((await phone(page)).value, '700 123 45');
    assert.equal(await page.evaluate("document.querySelector('.phone-input__prefix').innerText"), '+996');
    // Delete перед пробелом «700| 123 45» — удаляется цифра после пробела
    await caretAt(page, 3);
    await page.press('Delete');
    await phoneIs(page, '700 234 5');
    // Номер, начинающийся с 996, при обычном наборе не теряет цифр
    await selectAll(page);
    await page.press('Backspace');
    await phoneIs(page, '');
    await page.insertText('996123456');
    await phoneIs(page, '996 123 456');
    await page.close();
  });

  test('вставка и автозаполнение: +996 и местный номер с 0 распознаются; иностранный, длинный, с буквами — ошибка без обрезки', async () => {
    const page = await openAs('customer', { mode: 'checkout' });
    await page.waitFor("document.querySelector('#co-phone')", 'поле телефона');
    await paste(page, '+996 700 123 456');
    await phoneIs(page, '700 123 456');
    await paste(page, '(0555) 12-34-56');
    await phoneIs(page, '555 123 456');
    await paste(page, '996 700-12-34-56');
    await phoneIs(page, '700 123 456');
    for (const [text, key] of [['+7 912 345 67 89', 'phoneForeign'], ['+996 700 123 4567', 'phoneTooLong'], ['1234567890', 'phoneTooLong'], ['тел. 700 123 456', 'phoneInvalid']]) {
      await paste(page, text);
      await page.waitFor(`document.querySelector('#co-phone-error')?.innerText === ${JSON.stringify(v('ru')[key])}`, `ошибка ${key}: ${text}`);
      const s = await phone(page);
      assert.equal(s.value, '700 123 456', `${text}: поле не изменилось`);
      assert.equal(s.invalid, 'true');
      assert.equal(await page.evaluate("document.querySelector('#co-phone').getAttribute('aria-describedby')"), 'co-phone-error');
    }
    // Исправление: ошибка пропадает
    await caretAt(page, 11);
    await page.press('Backspace');
    await page.waitFor("!document.querySelector('#co-phone-error')", 'ошибка исчезла');
    // Автозаполнение браузера
    await autofill(page, '+996 555 000 111');
    await phoneIs(page, '555 000 111');
    await autofill(page, '0700123456');
    await phoneIs(page, '700 123 456');
    await autofill(page, '+44 20 7946 0958');
    await page.waitFor(`document.querySelector('#co-phone-error')?.innerText === ${JSON.stringify(v('ru').phoneForeign)}`, 'иностранный номер из автозаполнения');
    assert.equal((await phone(page)).value, '700 123 456');
    await page.close();
  });

  test('оформление: неполный номер — ошибка; в Firestore новый номер сохраняется как +996XXXXXXXXX', async () => {
    await seedProducts(); // C3.3: заказ оформляет сервер по каталогу Firestore
    const page = await openAs('customer', { mode: 'checkout' });
    await page.waitFor("document.querySelector('#co-phone')", 'форма');
    await page.type('#co-name', 'Айгерим');
    await page.type('#co-lastName', 'Асанова');
    await page.type('#co-email', 'aigerim@example.com');
    await page.evaluate("document.querySelector('input[name=agree]').click(), true");
    await caretAt(page, 0);
    await page.insertText('70012345');
    await page.click(dict('ru').checkout.placeOrder, 'form');
    await page.waitFor(`document.querySelector('#co-phone-error')?.innerText === ${JSON.stringify(v('ru').phone)}`, 'ошибка: 8 цифр');
    assert.equal(await page.evaluate('window.__e2eOrderId || null'), null, 'заказ не отправлен');
    await caretAt(page, 10);
    await page.insertText('6');
    await phoneIs(page, '700 123 456');
    await page.click(dict('ru').checkout.placeOrder, 'form');
    await page.waitFor('window.__e2eOrderId || window.__e2eOrderError', 'заказ сохранён');
    assert.equal(await page.evaluate('window.__e2eOrderError || null'), null);
    const id = await page.evaluate('window.__e2eOrderId');
    const saved = await readFullDoc(`users/${uids.customer}/orders/${id}`);
    assert.deepEqual(saved.customer, { name: 'Айгерим', lastName: 'Асанова', phone: '+996700123456', email: 'aigerim@example.com' });
    assert.equal(saved.status, 'new');
    await page.close();
  });

  test('админ-панель: старые номера — единый вид, иностранный — как есть, пустой — «—»; в базе ничего не меняется', async () => {
    await reseed();
    const uid = uids.customer;
    const legacy = {
      'OLD-LOCAL': await writeLegacyOrder(uid, 'OLD-LOCAL', '0700 123 456', '2026-10-03T10:00:00.000Z'),
      'OLD-FOREIGN': await writeLegacyOrder(uid, 'OLD-FOREIGN', '+7 912 345-67-89', '2026-10-02T10:00:00.000Z'),
      'OLD-EMPTY': await writeLegacyOrder(uid, 'OLD-EMPTY', '', '2026-10-01T10:00:00.000Z'),
    };
    const page = await openAs('owner', { path: `/admin/orders/${uid}/OLD-LOCAL` });
    const phoneCell = `[...document.querySelectorAll('.admin-dl dt')].find((d) => d.innerText === ${JSON.stringify(ru.orders.phone)})?.nextElementSibling`;
    await page.waitFor(`${phoneCell}?.innerText === '+996 700 123 456'`, 'старый местный номер в едином виде');
    assert.equal(await page.evaluate(`${phoneCell}.querySelector('a').getAttribute('href')`), 'tel:+996700123456');
    await page.evaluate(`window.__e2eNavigate('/admin/orders/${uid}/OLD-FOREIGN'), true`);
    await page.waitFor(`${phoneCell}?.innerText === '+7 912 345-67-89'`, 'иностранный номер как есть');
    assert.equal(await page.evaluate(`${phoneCell}.querySelector('a').getAttribute('href')`), 'tel:+79123456789');
    await page.evaluate(`window.__e2eNavigate('/admin/orders/${uid}/OLD-EMPTY'), true`);
    await page.waitFor(`${phoneCell}?.innerText === '—'`, 'пустой номер');
    // Список заказов
    await page.evaluate("window.__e2eNavigate('/admin/orders'), true");
    await page.waitFor("document.querySelectorAll('.admin-table tbody tr').length === 3", 'список заказов');
    const small = await page.evaluate("[...document.querySelectorAll('.admin-table tbody tr small')].map((s) => s.innerText)");
    assert.deepEqual(small, ['+996 700 123 456', '+7 912 345-67-89', '']);
    // Карточка покупателя: номер из последнего заказа
    await page.evaluate(`window.__e2eNavigate('/admin/customers/${uid}'), true`);
    const customerCell = `[...document.querySelectorAll('.admin-dl dt')].find((d) => d.innerText === ${JSON.stringify(ru.customers.phone)})?.nextElementSibling`;
    await page.waitFor(`${customerCell}?.innerText.startsWith('+996 700 123 456')`, 'телефон покупателя');
    assert.equal(await page.evaluate(`${customerCell}.querySelector('a').getAttribute('href')`), 'tel:+996700123456');
    await page.close();
    // Данные в базе — ровно те, что были записаны
    for (const [id, data] of Object.entries(legacy)) assert.deepEqual(await readFullDoc(`users/${uid}/orders/${id}`), data, id);
  });

  for (const lang of ['ru', 'ky', 'en']) {
    for (const theme of ['light', 'dark']) {
      test(`поле телефона на 320px: ${lang}, ${theme} — префикс и поле в одной строке, переводы, ничего не выходит за экран`, async () => {
        const page = await openAs('customer', { mode: 'checkout', lang, theme, width: 320 });
        await page.waitFor("document.querySelector('#co-phone')", 'поле телефона');
        const box = await page.evaluate(`(() => {
          const p = document.querySelector('.phone-input__prefix').getBoundingClientRect();
          const i = document.querySelector('#co-phone').getBoundingClientRect();
          const el = document.querySelector('#co-phone');
          return { pTop: p.top, pBottom: p.bottom, iTop: i.top, iBottom: i.bottom, pRight: p.right, iLeft: i.left, iRight: i.right, iWidth: i.width,
            type: el.type, inputMode: el.inputMode, autocomplete: el.autocomplete,
            label: document.querySelector('label[for=co-phone].field__label').innerText,
            prefixColor: getComputedStyle(document.querySelector('.phone-input__prefix')).color, bg: getComputedStyle(document.querySelector('.phone-input__prefix')).backgroundColor };
        })()`);
        assert.ok(Math.abs(box.pTop - box.iTop) < 1 && Math.abs(box.pBottom - box.iBottom) < 1, `${lang}: в одной строке`);
        assert.ok(box.pRight <= box.iLeft + 1, 'префикс слева от поля');
        assert.ok(box.iWidth >= 150, `поле достаточно широкое для 9 цифр: ${box.iWidth}`);
        assert.ok(box.iRight <= 320, 'поле в пределах экрана');
        assert.deepEqual([box.type, box.inputMode, box.autocomplete], ['tel', 'tel', 'tel'], 'телефонная клавиатура');
        assert.ok(box.label.includes(dict(lang).form.phone), `${lang}: подпись`);
        assert.notEqual(box.prefixColor, box.bg, 'префикс читается');
        await caretAt(page, 0);
        await page.insertText('700123456');
        await phoneIs(page, '700 123 456');
        assert.ok(await page.evaluate("(() => { const el = document.querySelector('#co-phone'); return el.scrollWidth <= el.clientWidth; })()"), 'номер виден целиком');
        await paste(page, '+7 912 345 67 89');
        await page.waitFor(`document.querySelector('#co-phone-error')?.innerText === ${JSON.stringify(v(lang).phoneForeign)}`, `${lang}: ошибка переведена`);
        const o = await overflow(page, '.checkout-form');
        assert.ok(o.sw <= o.vw, `страница шире экрана ${o.sw} > ${o.vw}`);
        assert.deepEqual(o.bad, []);
        await page.close();
      });
    }
  }
});

// ---------- C3.2, этап 1: адаптивность ----------

/** Каталог из src/data/products.js — в Firestore эмулятора (как импорт каталога в админке) */
async function seedProducts() {
  const { products } = await vite.ssrLoadModule('/src/data/products.js');
  const { toFirestoreProduct } = await vite.ssrLoadModule('/src/utils/products.js');
  for (const p of products) {
    const fields = toValue(toFirestoreProduct(p)).mapValue.fields;
    fields.updatedAt = { timestampValue: '2026-11-01T10:00:00.000Z' };
    const res = await fetch(`${DOCS}/products/${p.id}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    assert.equal(res.status, 200, `товар ${p.id}`);
  }
  return products.length;
}

const pageWidth = (page) => page.evaluate('({ vw: innerWidth, sw: document.documentElement.scrollWidth })');
const focusInFilters = (page) => page.evaluate("Boolean(document.querySelector('.filters')?.contains(document.activeElement))");
const activeDesc = (page) => page.evaluate("(() => { const a = document.activeElement; return a ? a.tagName + '.' + a.className : null; })()");

describe('C3.2: таблица товаров админки не расширяет страницу', () => {
  test('768, 1024, 1099 px (и 641, 1100, 1280): страница не шире экрана, таблица прокручивается внутри; 320 px — карточки', async () => {
    await reseed();
    const count = await seedProducts();
    const page = await openAs('owner', { path: '/admin/products' });
    await page.waitFor(`document.querySelectorAll('.admin-products__table tbody tr').length === ${count}`, 'таблица товаров');
    for (const width of [641, 768, 1024, 1099, 1100, 1280]) {
      await page.resize(width);
      await sleep(300);
      const { vw, sw } = await pageWidth(page);
      assert.equal(vw, width, `${width}: окно не расширено браузером`);
      assert.ok(sw <= vw, `${width}: страница шире экрана ${sw} > ${vw}`);
      const t = await page.evaluate(`(() => {
        const wrap = document.querySelector('.admin-table-wrap');
        const hidden = [...document.querySelectorAll('.admin-products__table thead .visually-hidden')];
        const before = wrap.scrollLeft;
        wrap.scrollLeft = 10000;
        const after = wrap.scrollLeft;
        wrap.scrollLeft = 0;
        return { client: wrap.clientWidth, scroll: wrap.scrollWidth, before, after, hidden: hidden.map((h) => [h.textContent, h.offsetParent === wrap]) };
      })()`);
      assert.deepEqual(t.hidden, [[ru.products.col.photo, true], [ru.products.col.actions, true]], `${width}: скрытые заголовки на месте, внутри таблицы`);
      if (t.scroll > t.client) assert.ok(t.after > t.before, `${width}: таблица прокручивается внутри`);
    }
    // Телефон: таблица — карточки, заголовков нет, страница не шире экрана
    await page.resize(320);
    await sleep(300);
    const phone = await pageWidth(page);
    assert.ok(phone.sw <= phone.vw, `320: ${phone.sw} > ${phone.vw}`);
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.admin-products__table thead')).display"), 'none');
    await page.close();
  });
});

describe('C3.2: мобильная панель фильтров каталога', () => {
  for (const width of [320, 375, 390, 430]) {
    test(`${width} px: закрытая недоступна, открытие — фокус внутрь, Tab/Shift+Tab по кругу, Escape — фокус на «Фильтры»`, async () => {
      const page = await openAs(null, { path: '/catalog', width });
      await page.waitFor("document.querySelector('.catalog__filters-btn') && document.querySelectorAll('.product-card').length > 0", 'каталог');
      // Закрыта: inert, aria-hidden, фокус внутрь не попадает ни программно, ни по Tab
      const closed = await page.evaluate(`(() => {
        const f = document.querySelector('.filters');
        const box = f.querySelector('input[type=checkbox]');
        box.focus();
        return { inert: f.inert, hidden: f.getAttribute('aria-hidden'), role: f.getAttribute('role'), focused: document.activeElement === box, expanded: document.querySelector('.catalog__filters-btn').getAttribute('aria-expanded') };
      })()`);
      assert.deepEqual(closed, { inert: true, hidden: 'true', role: null, focused: false, expanded: 'false' });
      await page.evaluate("document.querySelector('.catalog__filters-btn').focus(), true");
      for (let i = 0; i < 4; i++) {
        await page.press('Tab', { shift: true }); // панель в разметке — перед кнопкой
        assert.equal(await focusInFilters(page), false, `Shift+Tab ${i + 1}: фокус в закрытой панели`);
      }
      // Открыть: окно, фокус на «Закрыть», прокрутка страницы заблокирована
      await page.evaluate("document.querySelector('.catalog__filters-btn').focus(), document.querySelector('.catalog__filters-btn').click(), true");
      await page.waitFor("document.activeElement?.classList.contains('filters__close')", 'фокус на «Закрыть»');
      await page.waitFor("(() => { const r = document.querySelector('.filters').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; })()", 'панель выехала (анимация 0,3 с)');
      const opened = await page.evaluate(`(() => {
        const f = document.querySelector('.filters');
        const r = f.getBoundingClientRect();
        return { inert: f.inert, hidden: f.getAttribute('aria-hidden'), role: f.getAttribute('role'), modal: f.getAttribute('aria-modal'), overflow: document.body.style.overflow,
          expanded: document.querySelector('.catalog__filters-btn').getAttribute('aria-expanded'), inView: r.left >= -1 && r.right <= innerWidth + 1 };
      })()`);
      assert.deepEqual(opened, { inert: false, hidden: null, role: 'dialog', modal: 'true', overflow: 'hidden', expanded: 'true', inView: true });
      // Shift+Tab с первого элемента — на последний («Показать»), Tab с последнего — на первый
      await page.press('Tab', { shift: true });
      assert.match(await activeDesc(page), /filters__show/);
      await page.press('Tab');
      assert.match(await activeDesc(page), /filters__close/);
      const n = await page.evaluate("document.querySelectorAll('.filters button:not([disabled]), .filters input:not([disabled]), .filters a[href]').length");
      for (let i = 0; i < n + 3; i++) {
        await page.press('Tab');
        assert.equal(await focusInFilters(page), true, `Tab ${i + 1}: фокус вышел из окна`);
      }
      for (let i = 0; i < n + 3; i++) {
        await page.press('Tab', { shift: true });
        assert.equal(await focusInFilters(page), true, `Shift+Tab ${i + 1}: фокус вышел из окна`);
      }
      // Escape: закрыто, фокус на «Фильтры», снова недоступно
      await page.press('Escape');
      await page.waitFor("!document.querySelector('.filters').classList.contains('is-open')", 'закрыто по Escape');
      await page.waitFor("document.activeElement === document.querySelector('.catalog__filters-btn')", 'фокус вернулся на «Фильтры»');
      assert.deepEqual(await page.evaluate("[document.querySelector('.filters').inert, document.body.style.overflow, document.querySelector('.filters__backdrop')]"), [true, '', null]);
      await page.close();
    });
  }

  test('фильтрация работает после закрытия и повторного открытия; «Показать» и фон закрывают и возвращают фокус', async () => {
    const page = await openAs(null, { path: '/catalog', width: 375 });
    await page.waitFor("document.querySelectorAll('.product-card').length > 0", 'каталог');
    const cards = () => page.evaluate("document.querySelectorAll('.product-card').length");
    const all = await cards();
    await page.evaluate("document.querySelector('.catalog__filters-btn').click(), true");
    await page.waitFor("document.querySelector('.filters.is-open')", 'открыто');
    await page.evaluate("document.querySelector('.filters input[type=checkbox]').click(), true"); // первая категория
    await page.waitFor(`document.querySelectorAll('.product-card').length < ${all}`, 'список отфильтрован');
    const filtered = await cards();
    await page.evaluate("document.querySelector('.filters__show').click(), true");
    await page.waitFor("!document.querySelector('.filters.is-open') && document.activeElement === document.querySelector('.catalog__filters-btn')", '«Показать» закрыло, фокус на кнопке');
    assert.equal(await cards(), filtered, 'фильтр остался');
    // Повторно: отметка сохранена, сброс работает; закрытие по фону
    await page.evaluate("document.querySelector('.catalog__filters-btn').click(), true");
    await page.waitFor("document.querySelector('.filters.is-open')", 'открыто снова');
    assert.equal(await page.evaluate("document.querySelector('.filters input[type=checkbox]').checked"), true);
    await page.evaluate("[...document.querySelectorAll('.filters__actions button')][0].click(), true"); // «Сбросить»
    await page.waitFor(`document.querySelectorAll('.product-card').length === ${all}`, 'сброс');
    await page.evaluate("document.querySelector('.filters__backdrop').click(), true");
    await page.waitFor("!document.querySelector('.filters.is-open') && document.activeElement === document.querySelector('.catalog__filters-btn')", 'фон закрыл, фокус на кнопке');
    await page.close();
  });

  test('шире 959 px: боковая колонка как раньше — доступна, не окно; открытая на телефоне закрывается при расширении окна', async () => {
    const page = await openAs(null, { path: '/catalog', width: 1280 });
    await page.waitFor("document.querySelectorAll('.product-card').length > 0", 'каталог');
    const desk = await page.evaluate(`(() => {
      const f = document.querySelector('.filters');
      const box = f.querySelector('input[type=checkbox]');
      box.focus();
      return { inert: f.inert, hidden: f.getAttribute('aria-hidden'), role: f.getAttribute('role'), focused: document.activeElement === box, visible: f.getBoundingClientRect().left >= 0, btn: getComputedStyle(document.querySelector('.catalog__filters-btn')).display };
    })()`);
    assert.deepEqual(desk, { inert: false, hidden: null, role: null, focused: true, visible: true, btn: 'none' });
    await page.resize(375);
    await sleep(300);
    await page.evaluate("document.querySelector('.catalog__filters-btn').click(), true");
    await page.waitFor("document.querySelector('.filters.is-open')", 'открыто на телефоне');
    await page.resize(1280);
    await page.waitFor("!document.querySelector('.filters.is-open') && !document.querySelector('.filters').inert && document.body.style.overflow === ''", 'на компьютере — снова колонка');
    assert.equal(await page.evaluate("document.querySelector('.filters').getAttribute('role')"), null);
    await page.close();
  });
});

// ---------- C3.2, этап 2: шрифт полей, контраст по реальным цветам, области нажатия ----------

/** PNG (8 бит, RGB или RGBA) → пиксели; без пакетов: zlib из Node и фильтры строк PNG */
function decodePng(buf) {
  let pos = 8;
  let width, height, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'PNG: 8 бит');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, bpp, px };
}
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const rgbOf = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);

/**
 * Контраст текста элемента по фактическим цветам: цвет текста — из браузера, фон — пиксели снимка
 * под элементом (текст на время снимка прозрачный). Худший пиксель средней полосы элемента (без скруглённых краёв).
 */
/** Дождаться конца анимаций и плавных переходов на странице (появление карточек, смена цвета) */
const settleAnimations = (page) =>
  page.evaluate(`Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
    new Promise((r) => setTimeout(r, 3000)),
  ]).then(() => true)`);

/** Картинки загружены, элемент в центре окна и больше не сдвигается (раскладка устоялась) */
const settleElement = (page, selector) =>
  page.evaluate(`(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const pending = [...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 5000))]);
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let prev = '';
    for (let i = 0; i < 30; i++) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await frame();
      const r = el.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height, scrollY].map(Math.round).join(',');
      if (key === prev) return true;
      prev = key;
    }
    return false;
  })()`);

async function realContrast(page, selector) {
  await settleAnimations(page);
  assert.equal(await settleElement(page, selector), true, `${selector}: положение не устоялось`);
  const info = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    // Фон считается под самим текстом (WCAG): область текста, а не всего блока (блок бывает шире текста)
    const range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    const r = tr.width > 0 && tr.height > 0 ? tr : br;
    const cs = getComputedStyle(el);
    // Цвета — до скрытия текста (getComputedStyle «живой»)
    const out = { bx: Math.round(br.left + scrollX), by: Math.round(br.top + scrollY), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, color: cs.color, bg: cs.backgroundColor, fs: parseFloat(cs.fontSize), fw: +cs.fontWeight };
    el.style.setProperty('transition', 'none', 'important'); // без плавной смены цвета: текст исчезает сразу
    el.style.setProperty('color', 'transparent', 'important');
    el.style.setProperty('text-shadow', 'none', 'important');
    for (const c of el.querySelectorAll('*')) c.style.setProperty('visibility', 'hidden', 'important');
    return out;
  })()`);
  assert.ok(info, `нет элемента ${selector}`);
  await sleep(120);
  // Положение не изменилось за время скрытия текста — снимаем именно элемент
  const again = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY].map(Math.round).join(','); })()`);
  assert.equal(again, [info.bx, info.by].join(','), `${selector}: элемент сдвинулся перед снимком`);
  const inset = 2;
  const clip = { x: Math.round(info.x + inset), y: Math.round(info.y + info.h * 0.3), width: Math.max(1, Math.round(info.w - 2 * inset)), height: Math.max(1, Math.round(info.h * 0.4)) };
  const shot = await page.screenshot(clip);
  if (process.env.E2E_SHOT_DIR) {
    const name = selector.replace(/[^a-z0-9]+/gi, '_');
    writeFileSync(join(process.env.E2E_SHOT_DIR, `${name}-clip.png`), shot);
    writeFileSync(join(process.env.E2E_SHOT_DIR, `${name}-info.json`), JSON.stringify({ info, clip }));
  }
  const png = decodePng(shot);
  await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.style.removeProperty('color');
    el.style.removeProperty('text-shadow');
    getComputedStyle(el).color; // применить цвет сразу, затем вернуть плавные переходы — без анимации из прозрачного
    el.style.removeProperty('transition');
    for (const c of el.querySelectorAll('*')) c.style.removeProperty('visibility');
    return true;
  })()`);
  const fg = rgbOf(info.color);
  let worst = Infinity;
  let worstPx = null;
  for (let i = 0; i < png.px.length; i += png.bpp) {
    const p = [png.px[i], png.px[i + 1], png.px[i + 2]];
    const r = ratio(fg, p);
    if (r < worst) [worst, worstPx] = [r, p];
  }
  return { ratio: worst, fg: info.color, bgCss: info.bg, worstPx, fs: info.fs, fw: info.fw };
}

const C32_DARK = { gold: 'rgb(217, 184, 113)', primary: 'rgb(231, 166, 174)', success: 'rgb(127, 208, 162)' };

describe('C3.2, этап 2: контраст по реальным цветам в браузере', () => {
  let products;
  const prep = async () => {
    await reseed();
    await seedProducts();
    ({ products } = await vite.ssrLoadModule('/src/data/products.js'));
    const o = await writeLegacyOrder(uids.customer, 'C32-DELIVERED', '+996700123456', '2026-10-05T10:00:00.000Z');
    const res = await fetch(`${DOCS}/users/${uids.customer}/orders/${o.id}?updateMask.fieldPaths=status`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: { stringValue: 'delivered' } } }),
    });
    assert.equal(res.status, 200);
  };
  const cartPreload = () =>
    `localStorage.setItem('aroma_cart', ${JSON.stringify(JSON.stringify({ items: [{ key: `${products[0].id}__${products[0].volumes[0].ml}`, id: products[0].id, volume: products[0].volumes[0].ml, quantity: 1 }], promoCode: null }))});`;

  for (const theme of ['light', 'dark']) {
    test(`${theme}: «АДМИН», роль владельца, «Это вы», активное меню и фильтр, зелёные метки, «НОВИНКА», бренд, надпись на главной, номер шага`, async () => {
      if (theme === 'light') await prep();
      const results = [];
      const check = async (page, selector, darkColor) => {
        await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, selector);
        const r = await realContrast(page, selector);
        const large = r.fs >= 24 || (r.fs >= 18.66 && r.fw >= 700);
        results.push({ selector, ratio: +r.ratio.toFixed(2), fg: r.fg });
        assert.ok(r.ratio >= (large ? 3 : 4.5), `${theme} ${selector}: ${r.ratio.toFixed(2)} (текст ${r.fg}, худший фон ${r.worstPx})`);
        // Сплошной фон элемента — снимок совпадает с цветом из CSS (проверка, что снят именно этот элемент)
        const bg = r.bgCss.match(/[\d.]+/g)?.map(Number);
        if (bg && (bg.length === 3 || bg[3] === 1)) {
          assert.ok(r.worstPx.every((v, i) => Math.abs(v - bg[i]) <= 6), `${selector}: снимок ${r.worstPx} ≠ фон ${r.bgCss}`);
        }
        if (theme === 'dark' && darkColor) {
          const prop = selector === '.label--new' ? 'backgroundColor' : 'color';
          assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).${prop}`), darkColor, `${selector}: тёмная тема без изменений`);
        }
      };
      let page = await openAs('owner', { path: '/admin', theme });
      await check(page, '.admin__brand span', C32_DARK.gold);
      await check(page, '.admin__link.active', C32_DARK.primary);
      await check(page, '.admin-badge--ready', C32_DARK.success);
      await page.evaluate("window.__e2eNavigate('/admin/orders'), true");
      await check(page, '.admin-filter.is-active', C32_DARK.primary);
      await check(page, '.order__status--delivered', C32_DARK.success);
      await page.evaluate("window.__e2eNavigate('/admin/admins'), true");
      await check(page, '.admin-badge--role-owner', C32_DARK.gold);
      await check(page, '.admin-badge--self', C32_DARK.primary);
      await page.evaluate(`window.__e2eNavigate('/admin/products/${products[0].id}/edit'), true`);
      await check(page, '.admin-badge--visible', C32_DARK.success);
      await page.close();
      for (const width of [1280, 375]) {
        page = await openAs(null, { path: '/', theme, width });
        await check(page, '.eyebrow', C32_DARK.gold);
        await page.evaluate("window.__e2eNavigate('/catalog'), true");
        await check(page, '.label--new', C32_DARK.gold);
        const inStock = products.find((p) => p.availability === 'inStock');
        await page.evaluate(`window.__e2eNavigate('/product/${inStock.id}'), true`);
        await check(page, '.product-info__brand', C32_DARK.gold);
        await check(page, '.availability--inStock', C32_DARK.success);
        await page.close();
      }
      page = await openAs(null, { path: '/checkout', theme, preload: cartPreload() });
      await check(page, '.step-num', C32_DARK.primary);
      await page.close();
      console.log(`# контраст (${theme}):`, results.map((r) => `${r.selector} ${r.ratio}`).join('; '));
    });
  }
});

describe('C3.2, этап 2: шрифт полей 16px до 768px', () => {
  const fieldReport = (selector) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const text = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text || '' : el.value || el.placeholder || '';
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const r = el.getBoundingClientRect();
      return { id: el.id || el.className, fs: parseFloat(cs.fontSize), fits: ctx.measureText(text).width <= room + 1, text, h: Math.round(r.height), right: r.right };
    })`;
  for (const lang of ['ru', 'ky', 'en']) {
    for (const theme of ['light', 'dark']) {
      test(`${lang}, ${theme}: каталог (цена, сортировка) и админка (фильтры, сортировка) — 16px на 320/375/390/430, текст помещается; на 1024 — как раньше`, async () => {
        if (lang === 'ru' && theme === 'light') {
          await reseed();
          await seedProducts();
        }
        await reserveContexts(2);
        const site = await openAs(null, { path: '/catalog', lang, theme });
        const admin = await openAs('owner', { path: '/admin/products', lang, theme });
        await site.waitFor("document.querySelector('#sort-select') && document.querySelector('#price-min')", 'каталог');
        await admin.waitFor("document.querySelectorAll('.admin-toolbar__sort select').length === 5", 'фильтры товаров');
        for (const width of [320, 375, 390, 430, 1024]) {
          for (const [page, paths] of [[site, ['/catalog']], [admin, ['/admin/products', '/admin/customers', '/admin/reviews']]]) {
            await page.resize(width);
            for (const path of paths) {
              if (page === admin) {
                await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
                await page.waitFor(`window.__e2ePath === ${JSON.stringify(path)} && document.querySelector('.admin-toolbar__sort select')`, path);
              }
              await sleep(250);
              const sel = page === site ? '#price-min, #price-max, #sort-select' : '.admin-toolbar__sort select';
              const fields = await page.evaluate(fieldReport(sel));
              assert.ok(fields.length >= (page === site ? 3 : 1), `${path}: поля найдены`);
              for (const f of fields) {
                if (width <= 768) assert.ok(f.fs >= 16, `${lang} ${width} ${path} ${f.id}: ${f.fs}px`);
                else assert.ok(f.fs < 16, `${width} ${path} ${f.id}: на компьютере шрифт прежний (${f.fs}px)`);
                // Этап 3: подсказки цены помещаются и в компьютерной колонке (поля друг под другом)
                assert.ok(f.fits, `${lang} ${width} ${path} ${f.id}: текст «${f.text}» не помещается`);
                if (width <= 768) assert.ok(f.h >= 36, `${width} ${path} ${f.id}: высота ${f.h}`);
              }
              const { vw, sw } = await pageWidth(page);
              assert.ok(sw <= vw, `${lang} ${width} ${path}: страница шире экрана ${sw} > ${vw}`);
            }
          }
        }
        // Поля цены — одинаковой высоты (в открытой панели фильтров на телефоне)
        await site.resize(320);
        await site.evaluate("document.querySelector('.catalog__filters-btn').click(), true");
        await site.waitFor("document.querySelector('.filters.is-open')", 'панель открыта');
        const [a, b] = await site.evaluate(fieldReport('#price-min, #price-max'));
        assert.equal(a.h, b.h);
        assert.ok(a.fits && b.fits, `${lang}: «${a.text}», «${b.text}»`);
        await site.close();
        await admin.close();
      });
    }
  }
});

describe('C3.2, этап 2: области нажатия 44px на телефонах', () => {
  /** Размер и перекрытия: rect элемента (или область нажатия ::after) не пересекает другие элементы управления */
  const targets = (selector, { hit = false } = {}) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getClientRects().length).slice(0, 6).map((el) => {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      if (${hit}) {
        // Область нажатия — фактическая геометрия ::after (отсчёт от внутреннего края рамки)
        const a = getComputedStyle(el, '::after');
        const cs = getComputedStyle(el);
        const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(a.left);
        const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(a.top);
        box = { left, top, right: left + parseFloat(a.width), bottom: top + parseFloat(a.height) };
        // Углы области нажатия попадают в эту же кнопку
        // Середины четырёх краёв области 44×44 (самые углы может срезать скругление карточки с overflow: hidden)
        const cx = (box.left + box.right) / 2;
        const cy = (box.top + box.bottom) / 2;
        const pts = [[box.left + 1, cy], [box.right - 1, cy], [cx, box.top + 1], [cx, box.bottom - 1]];
        const miss = pts.map(([x, y]) => { const hitEl = document.elementFromPoint(x, y); return hitEl && (hitEl === el || el.contains(hitEl)) ? null : Math.round(x) + ',' + Math.round(y) + '→' + (hitEl ? hitEl.tagName + '.' + hitEl.className : 'null'); }).filter(Boolean);
        box.corners = miss.length ? miss.join(' | ') + ' (кнопка ' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ', область ' + [box.left, box.top, box.right, box.bottom].map(Math.round) + ')' : true;
      }
      // В открытом модальном окне соседи — только элементы этого окна (остальное закрыто фоном и недоступно)
      const scope = el.closest('[aria-modal="true"]') || document;
      const others = [...scope.querySelectorAll('a[href], button, input, select, textarea')].filter((o) => o !== el && !o.contains(el) && !el.contains(o) && o.getClientRects().length);
      const overlap = others.filter((o) => { const q = o.getBoundingClientRect(); return q.width && q.height && q.left < box.right - 0.5 && q.right > box.left + 0.5 && q.top < box.bottom - 0.5 && q.bottom > box.top + 0.5; })
        .map((o) => o.tagName + '.' + o.className);
      return { w: Math.round(box.right - box.left), h: Math.round(box.bottom - box.top), visual: [Math.round(r.width), Math.round(r.height)], corners: box.corners, overlap, text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 20) };
    })`;
  const expectTargets = async (page, selector, what, opts = {}) => {
    await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, what);
    await settleAnimations(page);
    const list = await page.evaluate(targets(selector, opts));
    assert.ok(list.length, what);
    for (const t of list) {
      assert.ok(t.h >= 44, `${what} «${t.text}»: высота ${t.h}`);
      if (opts.hit || opts.square) assert.ok(t.w >= 44, `${what}: ширина ${t.w}`);
      if (opts.hit) {
        assert.deepEqual(t.visual, [36, 36], `${what}: кнопка визуально прежняя`);
        assert.equal(t.corners, true, `${what}: края области нажатия — эта же кнопка: ${t.corners}`);
      }
      assert.deepEqual(t.overlap, [], `${what} «${t.text}»: перекрывает соседние элементы`);
    }
    return list;
  };

  for (const lang of ['ru', 'ky', 'en']) {
    test(`${lang}: 320/375/390/430 — «В корзину», уведомление, группы фильтров, «Смотреть все», WhatsApp и Instagram, админка; без переполнения`, async () => {
      if (lang === 'ru') {
        await reseed();
        await seedProducts();
        await writeLegacyOrder(uids.customer, 'C32-TAP', '+996700123456', '2026-10-05T10:00:00.000Z');
      }
      await reserveContexts(2);
      const site = await openAs(null, { path: '/', lang, width: 320 });
      const admin = await openAs('owner', { path: '/admin/orders', lang, width: 320 });
      for (const width of [320, 375, 390, 430]) {
        await site.resize(width);
        await site.evaluate("window.__e2eNavigate('/'), true");
        await sleep(300);
        await expectTargets(site, '.link-arrow', 'Смотреть все');
        await expectTargets(site, '.product-card__footer .btn--icon', 'В корзину', { hit: true });
        await expectTargets(site, '.footer .whatsapp-link, .footer .instagram-link', 'WhatsApp и Instagram');
        // Уведомление после «В корзину»: закрытие 44×44, внутри уведомления, уведомление не выросло
        await site.evaluate("document.querySelector('.product-card__footer .btn--icon:not(:disabled)').click(), true");
        await site.waitFor("document.querySelector('.toast__close')", 'уведомление');
        const toast = await site.evaluate(`(() => {
          const t = document.querySelector('.toast').getBoundingClientRect();
          const c = document.querySelector('.toast__close').getBoundingClientRect();
          const text = document.querySelector('.toast__text').getBoundingClientRect();
          return { cw: Math.round(c.width), ch: Math.round(c.height), inside: c.left >= t.left && c.right <= t.right && c.top >= t.top - 0.5 && c.bottom <= t.bottom + 0.5, th: t.height, textH: text.height };
        })()`);
        assert.ok(toast.cw >= 44 && toast.ch >= 44, `закрытие уведомления ${toast.cw}×${toast.ch}`);
        assert.ok(toast.inside, 'кнопка внутри уведомления');
        assert.ok(toast.th <= Math.max(toast.textH, 28) + 26, `уведомление не выросло: ${toast.th}`);
        await site.evaluate("document.querySelector('.toast__close').click(), true");
        // Каталог: группы фильтров в открытой панели
        await site.evaluate("window.__e2eNavigate('/catalog'), true");
        await site.waitFor("document.querySelector('.catalog__filters-btn')", 'каталог');
        await site.evaluate("document.querySelector('.catalog__filters-btn').click(), true");
        await site.waitFor("document.querySelector('.filters.is-open')", 'панель фильтров');
        await sleep(350);
        await expectTargets(site, '.filters .filter-group__toggle', 'группы фильтров');
        await site.press('Escape');
        await site.waitFor("!document.querySelector('.filters.is-open')", 'панель закрыта');
        const sp = await pageWidth(site);
        assert.ok(sp.sw <= sp.vw, `${lang} ${width}: сайт шире экрана`);
        // Админка
        await admin.resize(width);
        await admin.evaluate("window.__e2eNavigate('/admin/orders'), true");
        await sleep(300);
        await expectTargets(admin, '.admin-table__link', 'ссылки в таблице заказов');
        await admin.evaluate(`window.__e2eNavigate('/admin/orders/${uids.customer}/C32-TAP'), true`);
        await expectTargets(admin, '.admin-back', '«← Все заказы»');
        await admin.evaluate("window.__e2eNavigate('/admin/reviews'), true");
        await admin.waitFor("document.querySelector('.admin-review')", 'отзывы');
        await expectTargets(admin, '.admin-review__toggle', '«Показать полностью»');
        const ap = await pageWidth(admin);
        assert.ok(ap.sw <= ap.vw, `${lang} ${width}: админка шире экрана`);
      }
      await site.close();
      await admin.close();
    });
  }
});


// ---------- C3.2, этап 3: мелкий текст, верхняя полоса, шапка админки, плавающие кнопки ----------

const MOBILE = [320, 375, 390, 430];
const ALL_WIDTHS = [320, 375, 390, 430, 641, 768, 1024, 1280, 1920];

describe('C3.2, этап 3: мелкий текст 12px и верхняя полоса', () => {
  for (const lang of ['ru', 'ky', 'en']) {
    for (const theme of ['light', 'dark']) {
      test(`${lang}, ${theme}: бренд, метки, счётчик ≥ 12px без обрезки; полоса — обе части на 320–430, компактно, без наложения`, async () => {
        if (lang === 'ru' && theme === 'light') {
          await reseed();
          await seedProducts();
        }
        const { products } = await vite.ssrLoadModule('/src/data/products.js');
        const cart = JSON.stringify(JSON.stringify({ items: products.slice(0, 2).map((p) => ({ key: `${p.id}__${p.volumes[0].ml}`, id: p.id, volume: p.volumes[0].ml, quantity: 1 })), promoCode: null }));
        const page = await openAs(null, { path: '/catalog', lang, theme, width: 320, preload: `localStorage.setItem('aroma_cart', ${cart});` });
        await page.waitFor("document.querySelectorAll('.product-card').length > 0", 'каталог');
        for (const width of [...MOBILE, 641, 1024, 1280]) {
          await page.resize(width);
          await sleep(250);
          await settleAnimations(page);
          // Мелкий текст
          const small = await page.evaluate(`[...document.querySelectorAll('.product-card__brand, .label, .header .badge')].slice(0, 30).map((el) => ({
            cls: el.className, fs: parseFloat(getComputedStyle(el).fontSize), clipped: el.scrollWidth > el.clientWidth + 1, text: el.textContent.trim().slice(0, 20),
            inCard: (() => { const c = el.closest('.product-card'); if (!c) return true; const a = el.getBoundingClientRect(); const b = c.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; })(),
          }))`);
          assert.ok(small.some((s) => s.cls.includes('badge')), 'счётчик корзины на месте');
          for (const s of small) {
            assert.ok(s.fs >= 12, `${lang} ${width} ${s.cls} «${s.text}»: ${s.fs}px`);
            assert.equal(s.clipped, false, `${lang} ${width} ${s.cls} «${s.text}»: текст обрезан`);
            assert.equal(s.inCard, true, `${lang} ${width} «${s.text}»: выходит за карточку`);
          }
          // Верхняя полоса
          const promo = await page.evaluate(`(() => {
            const p = document.querySelector('.header__promo');
            const r = p.getBoundingClientRect();
            const parts = [...p.querySelectorAll('.header__promo-part')].map((x) => { const q = x.getBoundingClientRect(); return { top: q.top, bottom: q.bottom, left: q.left, right: q.right, text: x.textContent }; });
            const inner = document.querySelector('.header__inner').getBoundingClientRect();
            const lh = parseFloat(getComputedStyle(p).lineHeight) || parseFloat(getComputedStyle(p).fontSize) * 1.35;
            return { h: r.height, top: r.top, bottom: r.bottom, innerTop: inner.top, parts, clippedX: p.scrollWidth > p.clientWidth + 1, clippedY: p.scrollHeight > p.clientHeight + 1, ellipsis: getComputedStyle(p).textOverflow,
              lines: Math.round((r.height - parseFloat(getComputedStyle(p).paddingTop) - parseFloat(getComputedStyle(p).paddingBottom)) / lh),
              header: document.querySelector('.header').getBoundingClientRect().height, total: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-total')), vw: innerWidth };
          })()`);
          assert.equal(promo.parts.length, 2, 'две части сообщения');
          assert.ok(promo.bottom <= promo.innerTop + 0.5, `${width}: полоса наезжает на шапку`);
          assert.ok(promo.header <= promo.total + 0.5, `${lang} ${width}: шапка ${promo.header}px выше --header-total ${promo.total}px`);
          if (width <= 640) {
            assert.equal(promo.clippedX || promo.clippedY, false, `${lang} ${width}: полоса обрезана`);
            assert.ok(promo.parts[1].top >= promo.parts[0].bottom - 1, `${lang} ${width}: вторая часть — с новой строки`);
            for (const part of promo.parts) assert.ok(part.left >= -0.5 && part.right <= promo.vw + 0.5 && part.bottom <= promo.bottom + 0.5, `${lang} ${width}: «${part.text}» видна целиком`);
            assert.ok(promo.lines <= 3, `${lang} ${width}: ${promo.lines} строк`);
            assert.ok(promo.h <= 58, `${lang} ${width}: высота полосы ${promo.h}`);
          } else {
            assert.equal(promo.lines, 1, `${width}: на широком экране — одна строка (${promo.h}px)`);
          }
          const pw = await pageWidth(page);
          assert.ok(pw.sw <= pw.vw, `${lang} ${width}: страница шире экрана`);
        }
        // Бренд в корзине
        await page.evaluate("window.__e2eNavigate('/cart'), true");
        await page.waitFor("document.querySelector('.cart-item__brand')", 'корзина');
        for (const width of MOBILE) {
          await page.resize(width);
          await sleep(200);
          const b = await page.evaluate("[...document.querySelectorAll('.cart-item__brand')].map((el) => [parseFloat(getComputedStyle(el).fontSize), el.scrollWidth > el.clientWidth + 1])");
          for (const [fs, clipped] of b) {
            assert.ok(fs >= 12, `корзина ${width}: бренд ${fs}px`);
            assert.equal(clipped, false);
          }
        }
        await page.close();
      });
    }
  }
});

describe('C3.2, этап 3: шапка админки на телефоне', () => {
  const ROLE_ITEMS = { owner: 6, manager: 5, candidate: 5 };
  const headerReport = `(() => {
    const nav = document.querySelector('.admin__nav');
    const main = document.querySelector('.admin__main').getBoundingClientRect();
    const links = [...nav.querySelectorAll('.admin__link')].map((a) => a.getAttribute('href'));
    const actions = [...document.querySelectorAll('.admin__actions .icon-btn, .admin__actions .admin__action')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: r.left, right: r.right, top: r.top, bottom: r.bottom, name: (el.getAttribute('aria-label') || el.textContent).trim(), href: el.getAttribute('href') };
    });
    const st = getComputedStyle(nav);
    return { headerH: Math.round(main.top + scrollY), links, actions, more: [nav.dataset.moreLeft || null, nav.dataset.moreRight || null], mask: st.webkitMaskImage || st.maskImage, dir: st.flexDirection,
      vw: innerWidth, sw: document.documentElement.scrollWidth };
  })()`;
  const linkVisible = (href) => `(() => {
    const nav = document.querySelector('.admin__nav');
    const a = nav.querySelector('.admin__link[href="${href}"]');
    const n = nav.getBoundingClientRect(); const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inside: r.left >= n.left - 1 && r.right <= n.right + 1, hit: hit === a || a.contains(hit), active: a.classList.contains('active'), shadow: getComputedStyle(a).boxShadow, h: Math.round(r.height) };
  })()`;

  for (const role of ['owner', 'manager', 'candidate']) {
    test(`${role}: 320/375/390/430 — шапка компактная, все пункты меню доступны, подсказка прокрутки, действия 44px; 641/768 — лента; 1280 — как раньше`, async () => {
      if (role === 'owner') await reseed();
      const page = await openAs(role, { path: '/admin', width: 320 });
      await page.waitFor("document.querySelector('.admin__nav .admin__link') && document.querySelector('.admin__main')", 'админка');
      await page.waitFor(`document.querySelectorAll('.admin__nav .admin__link').length === ${ROLE_ITEMS[role]}`, `${ROLE_ITEMS[role]} пунктов меню`);
      for (const width of [...MOBILE, 641, 768]) {
        await page.resize(width);
        await page.evaluate("window.__e2eNavigate('/admin'), true");
        await sleep(300);
        const h = await page.evaluate(headerReport);
        assert.equal(h.links.length, ROLE_ITEMS[role]);
        assert.equal(h.links.includes('/admin/admins'), role === 'owner', `${role}: «Администраторы» — только у главного администратора`);
        assert.ok(h.sw <= h.vw, `${role} ${width}: страница шире экрана`);
        if (width <= 640) {
          assert.ok(h.headerH <= 160, `${role} ${width}: шапка ${h.headerH}px (было ~260)`);
          // Действия: язык, тема, «В магазин», «Выйти» — 44px, в одной строке, в пределах экрана, не перекрываются
          assert.equal(h.actions.length, 4);
          for (const a of h.actions) {
            assert.ok(a.w >= 44 && a.h >= 44, `${width} «${a.name}»: ${a.w}×${a.h}`);
            assert.ok(a.left >= 0 && a.right <= h.vw + 0.5, `${width} «${a.name}»: за экраном`);
          }
          for (let i = 1; i < h.actions.length; i++) assert.ok(h.actions[i].left >= h.actions[i - 1].right - 0.5, `${width}: кнопки перекрываются`);
          const names = h.actions.map((a) => a.name);
          assert.ok(names.includes(ru.backToShop) && names.includes(dict('ru').account.logout), `доступные имена: ${names}`);
          assert.equal(h.actions.find((a) => a.name === ru.backToShop).href, '/');
        }
        // Подсказка прокрутки: лента длиннее экрана — затухание справа
        const scrollable = await page.evaluate("(() => { const n = document.querySelector('.admin__nav'); return n.scrollWidth > n.clientWidth + 2; })()");
        if (scrollable) {
          await page.evaluate("document.querySelector('.admin__nav').scrollLeft = 0, true");
          await sleep(150);
          let m = await page.evaluate(headerReport);
          assert.deepEqual(m.more, [null, 'true'], `${width}: в начале — затухание справа`);
          assert.match(m.mask, /linear-gradient/);
          await page.evaluate("(() => { const n = document.querySelector('.admin__nav'); n.scrollLeft = n.scrollWidth; return true; })()");
          await sleep(150);
          m = await page.evaluate(headerReport);
          assert.deepEqual(m.more, ['true', null], `${width}: в конце — затухание слева`);
          // Вернуть ленту к началу, как после открытия страницы (переход на ту же страницу ленту не двигает)
          await page.evaluate("document.querySelector('.admin__nav').scrollLeft = 0, true");
          await sleep(100);
        }
        // Каждый пункт: переход по нему — пункт активен, виден целиком в ленте и отмечен полосой
        for (const href of h.links) {
          await page.evaluate(`window.__e2eNavigate(${JSON.stringify(href)}), true`);
          await page.waitFor(`document.querySelector('.admin__link.active')?.getAttribute('href') === ${JSON.stringify(href)}`, `${href} активен`);
          await sleep(150);
          const v = await page.evaluate(linkVisible(href));
          assert.equal(v.inside, true, `${role} ${width} ${href}: активный пункт не виден в ленте`);
          assert.equal(v.hit, true, `${role} ${width} ${href}: пункт перекрыт`);
          assert.ok(v.h >= 44, `${href}: высота пункта ${v.h}`);
          assert.match(v.shadow, /inset/, `${href}: активный пункт отмечен полосой`);
        }
      }
      // Компьютер: колонка меню, подписи кнопок видны, без затухания
      await page.resize(1280);
      await page.evaluate("window.__e2eNavigate('/admin'), true");
      await sleep(300);
      const d = await page.evaluate(headerReport);
      assert.equal(d.dir, 'column');
      assert.deepEqual(d.more, [null, null]);
      assert.equal(await page.evaluate("[...document.querySelectorAll('.admin__action-text')].every((s) => s.getBoundingClientRect().width > 20)"), true, 'на компьютере текст кнопок виден');
      await page.close();
    });
  }

  test('owner на 320 px: три языка и тёмная тема — шапка компактная, подписи переведены', async () => {
    for (const [lang, theme] of [['ky', 'light'], ['en', 'dark'], ['ru', 'dark']]) {
      const page = await openAs('owner', { path: '/admin/admins', lang, theme, width: 320 });
      await page.waitFor("document.querySelector('.admin__link.active')", 'админка');
      await sleep(300);
      const h = await page.evaluate(headerReport);
      assert.ok(h.headerH <= 160, `${lang}: шапка ${h.headerH}px`);
      assert.ok(h.sw <= h.vw);
      const names = h.actions.map((a) => a.name);
      assert.ok(names.includes(dict(lang).admin.backToShop) && names.includes(dict(lang).account.logout), `${lang}: ${names}`);
      const v = await page.evaluate(linkVisible('/admin/admins'));
      assert.equal(v.inside && v.hit, true, `${lang}: «Администраторы» видно`);
      await page.close();
    }
  });
});

describe('C3.2, этап 3: плавающие кнопки и область «В корзину»', () => {
  test('320/375/390/430: кнопки уходят при прокрутке вниз и возвращаются вверх и у подвала; без перекрытия подвала; корзина и оформление — без кнопок', async () => {
    const { products } = await vite.ssrLoadModule('/src/data/products.js');
    const fab = `(() => { const n = document.querySelector('.floating-contacts'); const r = n.getBoundingClientRect(); const st = getComputedStyle(n);
      // Этап 4: на телефоне видна одна кнопка запуска меню контактов
      const btns = [...n.querySelectorAll('.floating-contacts__launcher')].map((a) => { const q = a.getBoundingClientRect(); return { w: q.width, h: q.height, left: q.left, right: q.right, top: q.top, bottom: q.bottom }; });
      const wa = n.querySelector('a[href*="wa.me"]')?.getAttribute('href');
      return { away: n.classList.contains('floating-contacts--away'), display: st.display, visible: st.display !== 'none' && +st.opacity > 0.9 && r.left < innerWidth, pe: st.pointerEvents, btns, wa, vw: innerWidth, sw: document.documentElement.scrollWidth }; })()`;
    const step = (msg) => process.env.E2E_DEBUG && console.log(`# ${msg}`);
    for (const width of MOBILE) {
      const page = await openAs(null, { path: '/', width });
      for (const path of ['/', '/catalog', `/product/${products[0].id}`, '/reviews', '/contacts']) {
        step(`${width} ${path}: переход`);
        await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
        await page.waitFor("document.querySelector('.floating-contacts') && document.querySelector('main')", path);
        await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' }), true");
        await sleep(400);
        let f = await page.evaluate(fab);
        assert.equal(f.visible, true, `${width} ${path}: в начале страницы кнопки видны`);
        assert.equal(f.btns.length, 1, `${width}: на телефоне одна кнопка запуска`);
        assert.equal(f.wa, 'https://wa.me/996504889991');
        for (const b of f.btns) assert.ok(b.w >= 44 && b.h >= 44, `${width}: кнопка ${b.w}×${b.h}`);
        const scrollMax = await page.evaluate('document.documentElement.scrollHeight - innerHeight');
        if (scrollMax < 400) continue;
        step(`${width} ${path}: вниз`);
        // Вниз — кнопки уходят и не перехватывают нажатия
        for (const y of [150, 300, 450]) {
          await page.evaluate(`window.scrollTo({ top: ${y}, behavior: 'instant' }), true`);
          await sleep(80);
        }
        await sleep(400);
        f = await page.evaluate(fab);
        assert.equal(f.away, true, `${width} ${path}: при прокрутке вниз кнопки уходят`);
        assert.equal(f.visible, false);
        assert.equal(f.pe, 'none');
        assert.ok(f.sw <= f.vw, `${width} ${path}: ушедшие кнопки не расширяют страницу`);
        step(`${width} ${path}: фокус`);
        // Фокус с клавиатуры — видны
        await page.evaluate("document.querySelector('.floating-contacts__launcher').focus(), true");
        await sleep(350);
        assert.equal((await page.evaluate(fab)).visible, true, 'фокус показывает кнопки');
        await page.evaluate('document.activeElement.blur(), true');
        step(`${width} ${path}: вверх`);
        // Вверх — возвращаются
        await page.evaluate("window.scrollTo({ top: 250, behavior: 'instant' }), true");
        await sleep(450);
        f = await page.evaluate(fab);
        assert.equal(f.away, false, `${width} ${path}: при прокрутке вверх кнопки возвращаются`);
        step(`${width} ${path}: подвал`);
        // Подвал — кнопки видны и не закрывают ссылки подвала
        await page.evaluate('window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }), true');
        await sleep(500);
        f = await page.evaluate(fab);
        assert.equal(f.visible, true, `${width} ${path}: у подвала кнопки видны`);
        const overlap = await page.evaluate(`(() => { const btns = [...document.querySelectorAll('.floating-contacts__launcher')].map((a) => a.getBoundingClientRect());
          return [...document.querySelectorAll('.footer a, .footer button, .footer p, .footer li')].filter((el) => { const q = el.getBoundingClientRect(); return q.width && btns.some((b) => b.left < q.right && b.right > q.left && b.top < q.bottom && b.bottom > q.top); }).map((el) => el.tagName + ' ' + el.textContent.trim().slice(0, 20)); })()`);
        assert.deepEqual(overlap, [], `${width} ${path}: кнопки закрывают подвал`);
      }
      for (const path of ['/cart', '/checkout']) {
        await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
        await sleep(300);
        assert.equal((await page.evaluate(fab)).display, 'none', `${width} ${path}: кнопки скрыты, как раньше`);
      }
      await page.close();
    }
  });

  test('«В корзину»: круглая область нажатия 44px целиком внутри карточки (320–430)', async () => {
    const page = await openAs(null, { path: '/catalog', width: 320 });
    await page.waitFor("document.querySelector('.product-card__footer .btn--icon')", 'каталог');
    for (const width of MOBILE) {
      await page.resize(width);
      await sleep(250);
      await settleAnimations(page);
      const r = await page.evaluate(`[...document.querySelectorAll('.product-card__footer .btn--icon')].slice(0, 4).map((el) => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const b = el.getBoundingClientRect(); const a = getComputedStyle(el, '::after');
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2, rad = parseFloat(a.width) / 2 - 1, d = rad / Math.SQRT2;
        const pts = [[cx + rad, cy], [cx - rad, cy], [cx, cy + rad], [cx, cy - rad], [cx + d, cy + d], [cx - d, cy + d], [cx + d, cy - d], [cx - d, cy - d]];
        const miss = pts.filter(([x, y]) => { const h = document.elementFromPoint(x, y); return !(h === el || el.contains(h)); }).map((p) => p.map(Math.round).join(','));
        return { size: [parseFloat(a.width), parseFloat(a.height)], radius: a.borderRadius, visual: [Math.round(b.width), Math.round(b.height)], miss };
      })`);
      for (const x of r) {
        assert.deepEqual(x.size, [44, 44], `${width}: область ${x.size}`);
        assert.equal(x.radius, '50%');
        assert.deepEqual(x.visual, [36, 36]);
        assert.deepEqual(x.miss, [], `${width}: точки круга вне кнопки`);
      }
    }
    await page.close();
  });
});

describe('C3.2, этап 3: все основные страницы — без переполнения на всех ширинах', () => {
  for (const [lang, theme] of [['ru', 'light'], ['ky', 'dark'], ['en', 'light']]) {
    test(`${lang}, ${theme}: сайт и админка на 320–1920 px`, async () => {
      const { products } = await vite.ssrLoadModule('/src/data/products.js');
      const site = ['/', '/catalog', `/product/${products[0].id}`, '/cart', '/favorites', '/checkout', '/login', '/register', '/forgot-password', '/quiz', '/about', '/contacts', '/delivery', '/faq', '/reviews'];
      const admin = ['/admin', '/admin/orders', '/admin/products', '/admin/products/new', '/admin/customers', '/admin/reviews', '/admin/admins'];
      await reserveContexts(2);
      const pages = [[await openAs(null, { path: '/', lang, theme }), site], [await openAs('owner', { path: '/admin', lang, theme }), admin]];
      for (const [page, paths] of pages) {
        for (const path of paths) {
          await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
          await page.waitFor("document.querySelector('main') && !document.querySelector('main .spinner')", path);
          await sleep(300);
          for (const width of ALL_WIDTHS) {
            await page.resize(width);
            await sleep(120);
            const { vw, sw } = await pageWidth(page);
            assert.ok(sw <= vw, `${lang} ${theme} ${path} ${width}: страница шире экрана ${sw} > ${vw}`);
          }
        }
        await page.close();
      }
    });
  }
});

// ---------- C3.2, этап 4: кыргызские суммы, подписи 12px, меню контактов на телефоне ----------

describe('C3.2, этап 4: исправленные кыргызские строки и две подписи на экране', () => {
  for (const theme of ['light', 'dark']) {
    test(`ky, ${theme}: квиз (бюджет), FAQ (доставка), полоса — на 320–1280 px без обрезки; счётчик фильтров и метка совпадения ≥ 12px`, async () => {
      const ky = dict('ky');
      const page = await openAs(null, { path: '/quiz', lang: 'ky', theme, width: 320 });
      await page.waitFor("document.querySelector('.quiz-option input')", 'квиз');
      // Шаги 1–4: первый вариант и «Далее»; шаг 5 — бюджет
      for (let i = 0; i < 4; i++) {
        await page.evaluate("document.querySelector('.quiz-option input').click(), document.querySelector('.quiz__nav button[type=submit]').click(), true");
        await sleep(250);
      }
      await page.waitFor("document.querySelector('.quiz-options--budget')", 'вопрос о бюджете');
      for (const width of [320, 375, 390, 430, 768, 1024, 1280]) {
        await page.resize(width);
        await sleep(150);
        const labels = await page.evaluate(`[...document.querySelectorAll('.quiz-options--budget .quiz-option__label')].map((el) => ({ text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1, right: el.getBoundingClientRect().right }))`);
        const texts = labels.map((l) => l.text);
        assert.ok(texts.includes(ky.quiz.options.budget.economy) && texts.includes(ky.quiz.options.budget.premium), texts.join(' | '));
        assert.ok(!texts.some((x) => /KGS[а-яөүң]/i.test(x)));
        for (const l of labels) assert.ok(!l.clipped && l.right <= width + 0.5, `${width}: «${l.text}» обрезано`);
        const pw = await pageWidth(page);
        assert.ok(pw.sw <= pw.vw, `${width}: квиз шире экрана`);
      }
      // Результаты: малая метка совпадения
      await page.resize(375);
      await page.evaluate("document.querySelector('.quiz-option input').click(), document.querySelector('.quiz__nav button[type=submit]').click(), true");
      await page.waitFor("document.querySelector('.match-badge--sm')", 'результаты квиза');
      const badge = await page.evaluate("[...document.querySelectorAll('.match-badge--sm')].slice(0, 6).map((el) => [parseFloat(getComputedStyle(el).fontSize), el.scrollWidth > el.clientWidth + 1, parseFloat(getComputedStyle(document.querySelector('.match-badge:not(.match-badge--sm)') || el).fontSize)])");
      for (const [fs, clipped, main] of badge) {
        assert.ok(fs >= 12, `метка совпадения ${fs}px`);
        assert.equal(clipped, false);
        assert.ok(main >= fs, 'основная метка не мельче малой');
      }
      // FAQ: доставка
      await page.evaluate("window.__e2eNavigate('/faq'), true");
      await page.waitFor("document.querySelectorAll('.accordion__button').length > 3", 'FAQ');
      await page.evaluate("document.querySelectorAll('.accordion__button')[3].click(), true");
      await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ky.faq.items.delivery.a)})`, 'ответ о доставке');
      for (const width of [320, 430, 1280]) {
        await page.resize(width);
        await sleep(150);
        const pw = await pageWidth(page);
        assert.ok(pw.sw <= pw.vw, `FAQ ${width}: шире экрана`);
        assert.equal(await page.evaluate('document.querySelectorAll(".accordion__panel:not([hidden])")[0].scrollWidth <= document.querySelectorAll(".accordion__panel:not([hidden])")[0].clientWidth + 1'), true);
      }
      // Полоса: «Бишкекте» — кириллица, обе части видны
      const promo = await page.evaluate("document.querySelector('.header__promo').textContent");
      assert.ok(promo.includes('Бишкекте') && !/[A-Za-z]/.test(promo.replace(/KGS/g, '')), promo);
      // Счётчик выбранных фильтров
      await page.evaluate("window.__e2eNavigate('/catalog'), true");
      await page.resize(1280);
      await page.waitFor("document.querySelector('.filters input[type=checkbox]')", 'каталог');
      await page.evaluate("document.querySelector('.filters input[type=checkbox]').click(), true");
      await page.waitFor("document.querySelector('.filter-group__count')", 'счётчик фильтров');
      for (const width of [320, 1280]) {
        await page.resize(width);
        await sleep(200);
        const counts = await page.evaluate("[...document.querySelectorAll('.filter-group__count')].filter((el) => el.getClientRects().length).map((el) => [parseFloat(getComputedStyle(el).fontSize), el.scrollWidth > el.clientWidth + 1])");
        assert.ok(counts.length > 0);
        for (const [fs, clipped] of counts) {
          assert.ok(fs >= 12, `${width}: счётчик ${fs}px`);
          assert.equal(clipped, false);
        }
      }
      await page.close();
    });
  }
});

describe('C3.2, этап 4: меню контактов на телефоне', () => {
  /** Служебная плашка Firebase «Running in emulator mode» есть только на стенде с эмулятором; на узком экране
      она закрывает низ окна и перехватывает нажатия — на рабочем сайте её нет */
  const hideEmulatorBanner = (page) =>
    page.evaluate("document.head.insertAdjacentHTML('beforeend', '<style>.firebase-emulator-warning { display: none !important; }</style>'), true");
  const state = `(() => {
    const nav = document.querySelector('.floating-contacts');
    const st = getComputedStyle(nav);
    const launcher = nav.querySelector('.floating-contacts__launcher');
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height) }; };
    const items = [...nav.querySelectorAll('.floating-contacts__item')].filter((a) => a.getClientRects().length).map((a) => ({ ...rect(a), href: a.getAttribute('href'), target: a.target, rel: a.rel, name: a.getAttribute('aria-label'), text: a.textContent.trim() }));
    return { display: st.display, launcher: launcher && { ...rect(launcher), expanded: launcher.getAttribute('aria-expanded'), controls: launcher.getAttribute('aria-controls'), name: launcher.getAttribute('aria-label') },
      menuHidden: nav.querySelector('.floating-contacts__menu')?.hidden ?? null, items, desktopButtons: nav.querySelectorAll('.floating-contacts__btn').length,
      focus: document.activeElement === launcher ? 'launcher' : document.activeElement?.closest?.('.floating-contacts__item') ? document.activeElement.textContent.trim() : document.activeElement?.tagName,
      vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth };
  })()`;
  const launcherCenter = async (page) => {
    const s = await page.evaluate(state);
    return [s.launcher.left + s.launcher.w / 2, s.launcher.top + s.launcher.h / 2];
  };
  const expectOpen = async (page, lang, width) => {
    await page.waitFor("document.querySelector('.floating-contacts__launcher')?.getAttribute('aria-expanded') === 'true'", 'меню открыто');
    await settleAnimations(page); // замер после анимации появления
    const s = await page.evaluate(state);
    assert.equal(s.menuHidden, false);
    assert.equal(s.items.length, 2);
    assert.deepEqual(s.items.map((i) => i.href), ['https://wa.me/996504889991', 'https://www.instagram.com/aroma__donna/']);
    assert.deepEqual(s.items.map((i) => i.text), ['WhatsApp', 'Instagram']);
    assert.deepEqual(s.items.map((i) => i.name), [dict(lang).floatingContacts.whatsapp, dict(lang).floatingContacts.instagram]);
    for (const i of s.items) {
      assert.equal(i.target, '_blank');
      assert.equal(i.rel, 'noopener noreferrer');
      assert.ok(i.h >= 44 && i.w >= 44, `${width} ${i.text}: ${i.w}×${i.h}`);
      assert.ok(i.left >= 0 && i.right <= s.vw + 0.5 && i.top >= 0 && i.bottom <= s.vh, `${width} ${i.text}: за экраном`);
    }
    // Пункты и кнопка не перекрывают друг друга
    const boxes = [...s.items, s.launcher];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const x = boxes[a], y = boxes[b];
      assert.ok(!(x.left < y.right - 0.5 && x.right > y.left + 0.5 && x.top < y.bottom - 0.5 && x.bottom > y.top + 0.5), `${width}: элементы меню перекрываются`);
    }
    assert.ok(s.sw <= s.vw, `${width}: открытое меню расширяет страницу`);
    return s;
  };
  const expectClosed = async (page, what) => {
    await page.waitFor("document.querySelector('.floating-contacts__launcher')?.getAttribute('aria-expanded') === 'false'", `меню закрыто: ${what}`);
    const s = await page.evaluate(state);
    assert.equal(s.menuHidden, true, what);
    assert.equal(s.items.length, 0, `${what}: ссылки скрыты`);
    return s;
  };

  for (const width of [320, 375, 390, 430, 768]) {
    test(`${width} px: одна кнопка; открытие и закрытие мышью, снаружи, Escape, прокруткой, клавиатурой; переход по ссылкам; без переполнения`, async () => {
      const { products } = await vite.ssrLoadModule('/src/data/products.js');
      const page = await openAs(null, { path: '/', width });
      await hideEmulatorBanner(page);
      // Перехват перехода по ссылкам меню: адрес записывается, внешний сайт не открывается
      await page.evaluate(`(() => { window.__e2eOpened = []; document.addEventListener('click', (e) => { const a = e.target.closest('.floating-contacts a'); if (a) { e.preventDefault(); window.__e2eOpened.push(a.href); } }, true); return true; })()`);
      const step = (msg) => process.env.E2E_DEBUG && console.log(`# ${width}: ${msg}`);
      for (const path of ['/', '/catalog', `/product/${products[0].id}`, '/reviews', '/contacts']) {
        step(path);
        await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
        await page.waitFor("document.querySelector('.floating-contacts__launcher') && document.querySelector('main')", path);
        await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' }), true");
        await settleAnimations(page);
        let s = await page.evaluate(state);
        // Закрыто: одна кнопка ≥ 44, aria-expanded=false, в пределах экрана
        assert.equal(s.desktopButtons, 0, `${width} ${path}: на телефоне нет двух отдельных кнопок`);
        assert.ok(s.launcher.w >= 44 && s.launcher.h >= 44, `${width}: кнопка ${s.launcher.w}×${s.launcher.h}`);
        assert.equal(s.launcher.expanded, 'false');
        assert.equal(s.launcher.controls, 'floating-contacts-menu');
        assert.equal(s.launcher.name, dict('ru').floatingContacts.title);
        assert.ok(s.launcher.right <= s.vw && s.launcher.bottom <= s.vh, 'кнопка в пределах экрана');
        assert.equal(s.items.length, 0);
        if (path !== '/') continue; // полный набор действий — на главной; на остальных — вид и открытие
        step('1. Мышь:');
        // 1. Мышь: открыть, повторно — закрыть, фокус на кнопке
        let [x, y] = await launcherCenter(page);
        await page.mouse(x, y);
        await expectOpen(page, 'ru', width);
        await page.mouse(x, y);
        s = await expectClosed(page, 'повторное нажатие');
        assert.equal(s.focus, 'launcher', 'фокус на кнопке после закрытия');
        step('2. Нажатие вне ме');
        // 2. Нажатие вне меню
        await page.mouse(x, y);
        await expectOpen(page, 'ru', width);
        // Точка вне меню, где нет ссылок и кнопок (иначе нажатие откроет другую страницу)
        // Верхняя полоса «Бесплатная доставка…» — обычный текст, не ссылка и не кнопка
        const outside = await page.evaluate(`(() => { const r = document.querySelector('.header__promo').getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); return h && !h.closest('a, button, input, select, label, textarea, .floating-contacts') ? [x, y] : null; })()`);
        assert.ok(outside, 'нашлась точка вне меню');
        const [ox, oy] = outside;
        await page.mouse(ox, oy);
        await expectClosed(page, 'нажатие вне меню');
        assert.equal(await page.evaluate('window.__e2ePath'), '/', 'нажатие вне меню не открыло другую страницу');
        step('3. Клавиатура:');
        // 3. Клавиатура: Enter открывает, Tab — по пунктам, Shift+Tab — назад, Escape закрывает и возвращает фокус
        await page.evaluate("document.querySelector('.floating-contacts__launcher').focus(), true");
        await page.press('Enter');
        await expectOpen(page, 'ru', width);
        await page.press('Tab');
        assert.equal((await page.evaluate(state)).focus, 'WhatsApp');
        await page.press('Tab');
        assert.equal((await page.evaluate(state)).focus, 'Instagram');
        await page.press('Tab', { shift: true });
        assert.equal((await page.evaluate(state)).focus, 'WhatsApp');
        await page.press('Escape');
        s = await expectClosed(page, 'Escape');
        assert.equal(s.focus, 'launcher', 'Escape возвращает фокус на кнопку');
        step('Tab за пределы ме');
        // Tab за пределы меню закрывает его
        await page.press('Enter');
        await expectOpen(page, 'ru', width);
        await page.press('Tab');
        await page.press('Tab');
        await page.press('Tab');
        await expectClosed(page, 'фокус ушёл из меню');
        step('4. Прокрутка закр');
        // 4. Прокрутка закрывает
        await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' }), true");
        await sleep(200);
        [x, y] = await launcherCenter(page);
        await page.mouse(x, y);
        await expectOpen(page, 'ru', width);
        await page.evaluate("window.scrollBy({ top: 120, behavior: 'instant' }), true");
        await expectClosed(page, 'прокрутка');
        step('5. Переход по ссы');
        // 5. Переход по ссылкам: правильный адрес, меню закрывается
        for (const [i, href] of [[0, 'https://wa.me/996504889991'], [1, 'https://www.instagram.com/aroma__donna/']]) {
          await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' }), true");
          await sleep(250);
          [x, y] = await launcherCenter(page);
          await page.mouse(x, y);
          const open = await expectOpen(page, 'ru', width);
          const item = open.items[i];
          await page.mouse(item.left + item.w / 2, item.top + item.h / 2);
          await expectClosed(page, 'после перехода по ссылке');
          assert.equal(await page.evaluate('window.__e2eOpened.at(-1)'), href);
        }
      }
      // Корзина и оформление — без кнопок
      for (const path of ['/cart', '/checkout']) {
        await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
        await sleep(300);
        assert.equal((await page.evaluate(state)).display, 'none', `${width} ${path}: скрыто`);
      }
      await page.close();
    });
  }

  for (const [lang, theme] of [['ru', 'dark'], ['ky', 'light'], ['ky', 'dark'], ['en', 'light'], ['en', 'dark']]) {
    test(`375 px, ${lang}, ${theme}: доступные имена переведены, меню различимо и не выходит за экран`, async () => {
      const page = await openAs(null, { path: '/catalog', lang, theme, width: 375 });
      await hideEmulatorBanner(page);
      await page.waitFor("document.querySelector('.floating-contacts__launcher')", 'кнопка контактов');
      await settleAnimations(page);
      const s = await page.evaluate(state);
      assert.equal(s.launcher.name, dict(lang).floatingContacts.title);
      await page.mouse(s.launcher.left + s.launcher.w / 2, s.launcher.top + s.launcher.h / 2);
      await expectOpen(page, lang, 375);
      // Пункт меню отличается от фона страницы (своя подложка и рамка)
      const look = await page.evaluate("(() => { const a = getComputedStyle(document.querySelector('.floating-contacts__item')); return [a.backgroundColor, a.borderTopWidth, a.boxShadow !== 'none']; })()");
      assert.notEqual(look[0], 'rgba(0, 0, 0, 0)');
      assert.equal(look[2], true);
      await page.press('Escape');
      await expectClosed(page, 'Escape');
      await page.close();
    });
  }

  test('1024 и 1280 px: две отдельные кнопки, как раньше; открытое на телефоне меню закрывается при расширении окна', async () => {
    const page = await openAs(null, { path: '/', width: 375 });
    await hideEmulatorBanner(page);
    await page.waitFor("document.querySelector('.floating-contacts__launcher')", 'телефон');
    await settleAnimations(page);
    const s = await page.evaluate(state);
    await page.mouse(s.launcher.left + s.launcher.w / 2, s.launcher.top + s.launcher.h / 2);
    await expectOpen(page, 'ru', 375);
    for (const width of [1024, 1280]) {
      await page.resize(width);
      await page.waitFor("document.querySelectorAll('.floating-contacts__btn').length === 2", `${width}: две кнопки`);
      await settleAnimations(page);
      const d = await page.evaluate(`(() => { const n = document.querySelector('.floating-contacts'); return { launcher: n.querySelectorAll('.floating-contacts__launcher').length, btns: [...n.querySelectorAll('.floating-contacts__btn')].map((a) => { const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), w: Math.round(r.width), visible: getComputedStyle(a).opacity === '1' }; }), sw: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
      assert.equal(d.launcher, 0);
      assert.deepEqual(d.btns.map((b) => b.href), ['https://wa.me/996504889991', 'https://www.instagram.com/aroma__donna/']);
      for (const b of d.btns) assert.ok(b.w >= 44 && b.visible, `${width}: кнопка ${b.w}px`);
      assert.ok(d.sw <= d.vw);
    }
    // На компьютере корзина — кнопки видны, как раньше
    await page.evaluate("window.__e2eNavigate('/cart'), true");
    await sleep(300);
    assert.notEqual(await page.evaluate("getComputedStyle(document.querySelector('.floating-contacts')).display"), 'none');
    await page.close();
  });
});


describe('C3.2: кыргызские строки «бутигинин» и «туташтырылбаса» на экране', () => {
  test('ky: подпись секции преимуществ (главная, «О нас») и ответ «Эмне үчүн катталуу керек?» в FAQ — 320 и 1280 px, светлая и тёмная', async () => {
    const ky = dict('ky');
    for (const theme of ['light', 'dark']) {
      const page = await openAs(null, { path: '/', lang: 'ky', theme, width: 320 });
      // benefits.title — доступное имя секции преимуществ (aria-label), его читает экранный диктор
      for (const path of ['/', '/about']) {
        await page.evaluate(`window.__e2eNavigate(${JSON.stringify(path)}), true`);
        await page.waitFor("document.querySelector('section.benefits')", `${path}: секция преимуществ`);
        assert.equal(await page.evaluate("document.querySelector('section.benefits').getAttribute('aria-label')"), ky.benefits.title, path);
        for (const width of [320, 1280]) {
          await page.resize(width);
          await sleep(200);
          const { vw, sw } = await pageWidth(page);
          assert.ok(sw <= vw, `${theme} ${path} ${width}: страница шире экрана`);
        }
      }
      await page.evaluate("window.__e2eNavigate('/faq'), true");
      await page.waitFor("document.querySelectorAll('.accordion__button').length > 7", 'FAQ');
      await page.evaluate("document.querySelectorAll('.accordion__button')[7].click(), true");
      await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ky.faq.items.account.a)})`, 'ответ про аккаунт');
      for (const width of [320, 1280]) {
        await page.resize(width);
        await sleep(200);
        const { vw, sw } = await pageWidth(page);
        assert.ok(sw <= vw, `${theme} FAQ ${width}: страница шире экрана`);
        const r = await page.evaluate(`(() => { const el = [...document.querySelectorAll('.accordion__panel:not([hidden]) *, .accordion__panel:not([hidden])')].find((e) => e.textContent.trim() === ${JSON.stringify(ky.faq.items.account.a)}); return el ? [el.scrollWidth > el.clientWidth + 1, el.getBoundingClientRect().right <= innerWidth + 0.5] : null; })()`);
        assert.deepEqual(r, [false, true], `${theme} FAQ ${width}: ответ обрезан или не найден`);
      }
      await page.close();
    }
  });
});

// ---------- C3.3, этапы 4–5: оформление через /api/order и гостевые заказы в админке ----------
// API — тестовый плагин tests-e2e/orderApiPlugin.mjs (эмуляторы, Telegram подменён, App Check — тестовый токен).

const co = (lang = 'ru') => dict(lang).checkout;
const apiState = async (s = null) =>
  (await fetch(`${BASE}/api/_test/state`, s ? { method: 'POST', body: JSON.stringify(s) } : {})).json();
/** Все заказы эмулятора (users/* и guests/*): [{ path, data }] */
async function allOrdersE2E() {
  const res = await fetch(`${DOCS}:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'orders', allDescendants: true }] } }),
  });
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => ({ path: r.document.name.split('/documents/')[1], data: fromValue({ mapValue: { fields: r.document.fields } }) }));
}
async function patchProduct(id, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${DOCS}/products/${id}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toValue(fields).mapValue.fields }),
  });
  assert.equal(res.status, 200, `товар ${id}`);
}
/** Заказ через API напрямую (для подготовки админки): гость — App Check, покупатель — ID-токен */
async function apiOrder({ idToken = null, name, lastName, phone, product, volume, quantity = 1 }) {
  const headers = { 'Content-Type': 'application/json' };
  const body = {
    requestId: crypto.randomUUID(),
    items: [{ productId: product.id, volume: volume.ml, quantity }],
    promoCode: null,
    deliveryMethod: 'pickup',
    paymentMethod: 'cashOnDelivery',
    customer: { name, lastName, phone, email: `${name.toLowerCase()}@example.com` },
    shipping: { comment: '' },
    agree: true,
    expectedTotal: volume.price * quantity,
  };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  else {
    headers['X-Firebase-AppCheck'] = (await (await fetch(`${BASE}/api/_test/app-check-token`)).json()).token;
    body.guestSessionId = crypto.randomUUID();
  }
  const res = await fetch(`${BASE}/api/order`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  assert.equal(res.status, 201, JSON.stringify(data));
  return data.order;
}
async function idTokenOf({ email, password }) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return (await res.json()).idToken;
}

describe('C3.3, этап 4: оформление заказа через защищённый /api/order', () => {
  let product;
  let volume;
  const GUEST = { name: 'Гульназ', lastName: 'Тестова', phone: '555000111', email: 'gulnaz-e2e@example.com' };
  const prep = async (state = { appCheck: 'ok', telegram: { mode: 'ok', delayMs: 0, calls: 0 } }) => {
    await reseed(); // заодно сбрасывает счётчики частоты заказов
    await seedProducts();
    const { products } = await vite.ssrLoadModule('/src/data/products.js');
    product = products.find((p) => p.availability === 'inStock');
    volume = [...product.volumes].sort((x, y) => x.price - y.price)[0];
    await apiState(state);
  };
  const cartPreload = () =>
    `localStorage.setItem('aroma_cart', ${JSON.stringify(JSON.stringify({ items: [{ key: `${product.id}__${volume.ml}`, id: product.id, volume: volume.ml, quantity: 1 }], promoCode: null }))});`;
  const cartCount = (page) => page.evaluate("JSON.parse(localStorage.getItem('aroma_cart') || '{\"items\":[]}').items.length");
  async function fill(page, who = GUEST) {
    await page.waitFor("document.querySelector('#co-name') && document.querySelector('.summary__items li')", 'форма и корзина');
    await page.evaluate("document.querySelector('input[name=delivery][value=pickup]').click(), true");
    await page.type('#co-name', who.name);
    await page.type('#co-lastName', who.lastName);
    await page.type('#co-email', who.email);
    await selectAll(page);
    await page.press('Backspace');
    await caretAt(page, 0);
    await page.insertText(who.phone);
    await page.evaluate("document.querySelector('#co-agree').checked || document.querySelector('#co-agree').click(), true");
  }
  const submit = (page, lang = 'ru') => page.click(co(lang).placeOrder, 'form');
  const successId = async (page) => {
    await page.waitFor("window.__e2ePath?.startsWith('/order-success/')", 'страница результата', 20000);
    return page.evaluate("window.__e2ePath.split('/').pop()");
  };
  const errorIs = (page, text) => page.waitFor(`document.querySelector('.form__error[role=alert]')?.innerText === ${JSON.stringify(text)}`, `сообщение: ${text}`, 20000);
  const signIn = (page, role) =>
    page.evaluate(`(async () => {
      const { getFirebase } = await import('/src/services/firebase.js');
      const { auth, authApi } = await getFirebase();
      await authApi.signInWithEmailAndPassword(auth, ${JSON.stringify(USERS[role].email)}, ${JSON.stringify(USERS[role].password)});
      return true;
    })()`);
  /** Задержка запроса /api/order в браузере: тест меняет каталог, пока заказ «в пути» */
  const gateOrders = (page) =>
    page.evaluate(`(() => {
      const orig = window.fetch;
      window.__e2eGate = 'off';
      window.fetch = async (u, o) => {
        if (String(u) === '/api/order' && window.__e2eGate === 'armed') {
          window.__e2eGate = 'waiting';
          await new Promise((r) => (window.__e2eRelease = r));
          window.__e2eGate = 'off';
        }
        return orig(u, o);
      };
      return true;
    })()`);

  test('1/7. гость: заказ через API, номер на странице результата, корзина очищена, в браузере нет персональных данных; обновление не отправляет заказ снова', async () => {
    await prep();
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(co().firebaseGuestNotice)})`, 'честное уведомление для гостя');
    await fill(page);
    await submit(page);
    const id = await successId(page);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(id)}) && document.body.innerText.includes(${JSON.stringify(dict('ru').success.serverText)})`, 'номер заказа и текст');
    assert.equal(await cartCount(page), 0, 'корзина очищена после подтверждённого ответа');
    const storage = await page.evaluate('JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } })');
    for (const pii of [GUEST.name, GUEST.lastName, GUEST.phone, GUEST.email]) assert.ok(!storage.includes(pii), `в хранилище браузера: ${pii}`);
    assert.ok(storage.includes(id), 'сводка заказа (номер, сумма) сохранена');
    const orders = await allOrdersE2E();
    assert.equal(orders.length, 1);
    assert.match(orders[0].path, new RegExp(`^guests/[0-9a-f]{40}/orders/${id}$`));
    const o = orders[0].data;
    assert.deepEqual([o.userId, o.customerType, o.status, o.paymentStatus, o.total, o.notification.status], [null, 'guest', 'new', 'awaitingPayment', volume.price, 'sent']);
    assert.equal(o.customer.phone, '+996555000111');
    // «Обновление» страницы результата: полная перезагрузка по адресу результата — заказ не отправляется снова
    const calls = (await apiState()).telegram.calls;
    await page.evaluate(`location.href = '/tests-e2e/admins-harness.html?mode=site&lang=ru&theme=light&path=/order-success/${id}', true`);
    await page.waitFor(`window.__e2eReady && document.body.innerText.includes(${JSON.stringify(id)})`, 'результат после перезагрузки', 20000);
    assert.equal((await allOrdersE2E()).length, 1);
    assert.equal((await apiState()).telegram.calls, calls);
    await page.close();
  });

  test('2/11. вошедший покупатель: заказ в users/{uid}/orders (UID из токена); в кабинете — новый и старый (paidDemo) заказы', async () => {
    await prep();
    await writeLegacyOrder(uids.customer, 'OLD-PAIDDEMO', '+996700123456', '2026-10-02T10:00:00.000Z');
    await fetch(`${DOCS}/users/${uids.customer}/orders/OLD-PAIDDEMO?updateMask.fieldPaths=paymentStatus`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { paymentStatus: { stringValue: 'paidDemo' } } }),
    });
    const legacyBefore = await readFullDoc(`users/${uids.customer}/orders/OLD-PAIDDEMO`);
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await page.waitFor('window.__e2eReady', 'стенд');
    await signIn(page, 'customer');
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(co().firebaseNotice)})`, 'вход выполнен');
    await fill(page, { ...GUEST, name: 'Айдана', email: 'user@test.local' });
    await submit(page);
    const id = await successId(page);
    const saved = await readFullDoc(`users/${uids.customer}/orders/${id}`);
    assert.deepEqual([saved.userId, saved.customerType, saved.status, saved.paymentStatus], [uids.customer, 'registered', 'new', 'awaitingPayment']);
    assert.equal((await allOrdersE2E()).filter((x) => x.path.startsWith('guests/')).length, 0, 'не гостевой заказ');
    await page.evaluate("window.__e2eNavigate('/account'), true");
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(id)}) && document.body.innerText.includes('OLD-PAIDDEMO')`, 'кабинет: новый и старый заказы');
    assert.ok((await page.text()).includes(dict('ru').paymentStatus.paidDemo), 'старый статус «Оплачен (DEMO)» показан как есть');
    assert.deepEqual(await readFullDoc(`users/${uids.customer}/orders/OLD-PAIDDEMO`), legacyBefore, 'старый заказ не изменён');
    await page.close();
  });

  test('3/6. гость без App Check (токен недоступен или неверный) — понятное сообщение, заказа нет, корзина сохранена', async () => {
    await prep({ appCheck: 'off', telegram: { mode: 'ok', delayMs: 0, calls: 0 } });
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await fill(page);
    await submit(page);
    await errorIs(page, co().errors.verification);
    await apiState({ appCheck: 'invalid' });
    await submit(page);
    await page.waitFor('!document.querySelector("form button[type=submit]").disabled', 'форма снова доступна', 20000);
    await errorIs(page, co().errors.verification);
    assert.equal(await cartCount(page), 1, 'корзина сохранена');
    assert.equal(await page.evaluate('window.__e2ePath'), '/checkout');
    assert.equal((await allOrdersE2E()).length, 0);
    await apiState({ appCheck: 'ok' });
    await page.close();
  });

  test('4. вошедший с недействительным токеном — «сессия истекла», заказ не оформляется как гостевой', async () => {
    await prep();
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await page.waitFor('window.__e2eReady', 'стенд');
    await signIn(page, 'customer');
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(co().firebaseNotice)})`, 'вход выполнен');
    await page.evaluate(`(async () => {
      const { getFirebase } = await import('/src/services/firebase.js');
      const { auth } = await getFirebase();
      auth.currentUser.getIdToken = async () => 'not-a-real-token-but-long-enough-xx';
      return true;
    })()`);
    await fill(page, { ...GUEST, email: 'user@test.local' });
    await submit(page);
    await errorIs(page, co().errors.sessionExpired);
    assert.equal(await cartCount(page), 1);
    assert.equal((await allOrdersE2E()).length, 0, 'ни обычного, ни гостевого заказа');
    await page.close();
  });

  test('8. ответ потерян, повторная отправка того же заказа (тот же requestId) и двойное нажатие — один заказ', async () => {
    await prep();
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await fill(page);
    await page.evaluate(`(() => {
      const orig = window.fetch;
      let n = 0;
      window.__e2eRequestIds = [];
      window.fetch = async (u, o) => {
        if (String(u) === '/api/order') {
          window.__e2eRequestIds.push(JSON.parse(o.body).requestId);
          if (n++ === 0) {
            await orig(u, o); // сервер заказ сохранил, а ответ «потерялся»
            throw new TypeError('Failed to fetch');
          }
        }
        return orig(u, o);
      };
      return true;
    })()`);
    await submit(page);
    await errorIs(page, co().errors.network);
    assert.equal(await cartCount(page), 1, 'после сбоя корзина на месте');
    // Двойное нажатие: второй клик — пока идёт отправка
    await page.evaluate("(() => { const b = document.querySelector('form button[type=submit]'); b.click(); b.click(); return true; })()");
    const id = await successId(page);
    const ids = await page.evaluate('window.__e2eRequestIds');
    assert.ok(ids.length >= 2 && ids.every((x) => x === ids[0]), `один requestId: ${ids}`);
    const orders = await allOrdersE2E();
    assert.equal(orders.length, 1, 'один заказ');
    assert.ok(orders[0].path.endsWith(`/${id}`));
    assert.equal((await apiState()).telegram.calls, 1, 'одно уведомление');
    await page.close();
  });

  test('9. цена изменилась, пока заказ отправлялся — окно с ценами сервера; после подтверждения — заказ по новой цене', async () => {
    await prep();
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await fill(page);
    await gateOrders(page);
    await page.evaluate("window.__e2eGate = 'armed', true");
    await submit(page);
    await page.waitFor("window.__e2eGate === 'waiting'", 'запрос задержан');
    const newPrice = volume.price + 500;
    const volumes = product.volumes.map(({ ml, price }) => ({ ml, price: ml === volume.ml ? newPrice : price }));
    await patchProduct(product.id, { volumes, price: Math.min(...volumes.map((x) => x.price)) });
    await page.evaluate('window.__e2eRelease(), true');
    await page.waitFor("document.querySelector('.checkout-review .checkout-review__total')", 'окно подтверждения новых цен', 20000);
    const review = await page.evaluate("document.querySelector('.checkout-review').innerText");
    assert.ok(review.includes(co().review.confirmNew), 'кнопка подтверждения');
    assert.equal(await page.count('.checkout-review s'), 1, 'старая цена зачёркнута');
    assert.equal((await allOrdersE2E()).length, 0, 'заказа нет до подтверждения');
    assert.equal(await cartCount(page), 1);
    await page.click(co().review.confirmNew, '.checkout-review');
    await successId(page);
    const orders = await allOrdersE2E();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].data.total, newPrice, 'итог — по цене сервера');
    await page.close();
  });

  test('10. товар закончился, пока заказ отправлялся — список недоступных позиций, заказа нет, корзина сохранена', async () => {
    await prep();
    const page = await openAs(null, { path: '/checkout', preload: cartPreload() });
    await fill(page);
    await gateOrders(page);
    await page.evaluate("window.__e2eGate = 'armed', true");
    await submit(page);
    await page.waitFor("window.__e2eGate === 'waiting'", 'запрос задержан');
    await patchProduct(product.id, { availability: 'outOfStock' });
    await page.evaluate('window.__e2eRelease(), true');
    await page.waitFor("document.querySelector('.checkout-review .checkout-review__reason')", 'список недоступных позиций', 20000);
    const text = await page.evaluate("document.querySelector('.checkout-review').innerText");
    assert.ok(text.includes(product.name), 'название товара');
    assert.ok(text.includes(co().review.problem.outOfStock), 'причина');
    assert.equal((await allOrdersE2E()).length, 0);
    assert.equal(await cartCount(page), 1);
    await page.close();
  });
});

describe('C3.3, этап 5: гостевые заказы в админке', () => {
  let product;
  let volume;
  let guestSent;
  let guestFailed;
  let registered;
  const rows = (page) => page.evaluate("[...document.querySelectorAll('.admin-table tbody tr')].map((r) => r.innerText)");
  const rowsCount = (page, n, what) => page.waitFor(`document.querySelectorAll('.admin-table tbody tr').length === ${n}`, what);
  const prep = async () => {
    await reseed();
    await seedProducts();
    const { products } = await vite.ssrLoadModule('/src/data/products.js');
    product = products.find((p) => p.availability === 'inStock');
    volume = [...product.volumes].sort((x, y) => x.price - y.price)[0];
    await apiState({ appCheck: 'ok', telegram: { mode: 'ok', delayMs: 0 } });
    guestSent = await apiOrder({ name: 'Нурия', lastName: 'Гостева', phone: '555123123', product, volume, quantity: 2 });
    await apiState({ telegram: { mode: 'fail' } });
    guestFailed = await apiOrder({ name: 'Эрмек', lastName: 'Сбоев', phone: '777888999', product, volume, quantity: 3 });
    await apiState({ telegram: { mode: 'ok' } });
    registered = await apiOrder({ idToken: await idTokenOf(USERS.customer), name: 'Айдана', lastName: 'Покупатель', phone: '700111222', product, volume });
    await writeLegacyOrder(uids.customer, 'OLD-E2E-1', '0700 999 888', '2026-10-03T10:00:00.000Z');
  };
  const guestPath = async (orderId) => (await allOrdersE2E()).find((o) => o.path.endsWith(`/orders/${orderId}`)).path;

  test('12/13. владелец: гостевые и обычные заказы вместе, метка «Гость»; поиск, статус, дата и сортировка', async () => {
    await prep();
    const page = await openAs('owner', { path: '/admin/orders' });
    await rowsCount(page, 4, 'все заказы: 2 гостевых, обычный, старый');
    assert.equal(await page.count('.admin-table tbody .admin-badge--guest'), 2);
    const text = (await rows(page)).join('\n');
    for (const o of [guestSent, guestFailed, registered]) assert.ok(text.includes(o.orderId), o.orderId);
    assert.ok(text.includes('OLD-E2E-1'));
    // Поиск: имя, телефон (с 0 и с +996), номер
    const search = async (q, n) => {
      await page.type('.admin-toolbar__search input', q);
      await rowsCount(page, n, `поиск «${q}»`);
    };
    await search('Эрмек', 1);
    assert.ok((await rows(page))[0].includes(guestFailed.orderId));
    await search('0555 123', 1);
    assert.ok((await rows(page))[0].includes(guestSent.orderId));
    await search('+996 700 111', 1);
    await search(registered.orderId.toLowerCase(), 1);
    await search('нет-такого', 0);
    assert.ok((await page.text()).includes(ru.orders.emptySearch));
    await search('', 4);
    // Дата: только старый заказ (3 октября)
    await page.evaluate("window.__e2eNavigate('/admin/orders?from=2026-10-01&to=2026-10-05'), true");
    await rowsCount(page, 1, 'фильтр по дате');
    assert.ok((await rows(page))[0].includes('OLD-E2E-1'));
    // Сортировка по сумме: 3 шт. > 2 шт. > 1 шт.
    await page.evaluate("window.__e2eNavigate('/admin/orders?sort=totalDesc'), true");
    await rowsCount(page, 4, 'сортировка');
    const sorted = await rows(page);
    assert.ok(sorted[0].includes(guestFailed.orderId) && sorted[1].includes(guestSent.orderId), sorted.join(' | '));
    // Фильтр статуса вместе с поиском: «Новый» + «Нурия»
    await page.evaluate(`window.__e2eNavigate('/admin/orders?status=new&q=${encodeURIComponent('Нурия')}'), true`);
    await rowsCount(page, 1, 'статус + поиск');
    await page.close();
  });

  test('14/15/18/19. карточка гостевого заказа: данные и уведомление; смена статуса; повтор Telegram только для failed', async () => {
    const page = await openAs('owner', { path: '/admin/orders' });
    await rowsCount(page, 4, 'список');
    // Переход по ссылке гостевого заказа — путь guests/{guestKey}, а не UID
    await page.evaluate(`[...document.querySelectorAll('.admin-table__link')].find((a) => a.innerText.includes(${JSON.stringify(guestFailed.orderId)})).click(), true`);
    await page.waitFor(`window.__e2ePath?.startsWith('/admin/orders/guest/')`, 'карточка гостевого заказа');
    const path = await guestPath(guestFailed.orderId);
    assert.equal(await page.evaluate('window.__e2ePath'), `/admin/orders/guest/${path.split('/')[1]}/${guestFailed.orderId}`);
    await page.waitFor("document.querySelector('.admin-order-notify .admin-notify--failed')", 'статус уведомления «Не отправлено»');
    const card = await page.text();
    for (const s of ['Эрмек', '+996 777 888 999', ru.orders.guest, ru.orders.notify.title]) assert.ok(card.includes(s), s);
    // Статус гостевого заказа (этап 6): сохраняется в guests/{guestKey}/orders, системные поля не меняются
    const before = await readFullDoc(path);
    await page.evaluate(`(() => { const s = document.querySelector('#order-status'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'confirmed'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await page.click(ru.orders.saveStatus, '.admin-status-form');
    await page.waitFor("document.querySelector('.admin-page__head .order__status--confirmed')", 'статус гостевого заказа сохранён');
    assert.ok(!(await page.text()).includes(ru.orders.errors['guest-status-rules']));
    const afterSave = await readFullDoc(path);
    assert.equal(afterSave.status, 'confirmed');
    assert.ok(afterSave.statusUpdatedAt, 'время изменения');
    for (const key of ['id', 'userId', 'customerType', 'items', 'total', 'subtotal', 'customer', 'payment', 'paymentStatus', 'createdAt']) assert.deepEqual(afterSave[key], before[key], key);
    // Повтор Telegram: подтверждение → отправлено
    const calls = (await apiState()).telegram.calls;
    await page.click(ru.orders.notify.resend, '.admin-order-notify');
    await page.waitFor("document.querySelector('.admin-order-notify__confirm')", 'подтверждение');
    assert.equal((await apiState()).telegram.calls, calls, 'до подтверждения ничего не отправлено');
    await page.click(ru.orders.notify.confirmSend, '.admin-order-notify__confirm');
    await page.waitFor(`document.querySelector('.admin-order-notify__ok')?.innerText === ${JSON.stringify(ru.orders.notify.result.sent)}`, 'результат «отправлено»');
    await page.waitFor("document.querySelector('.admin-order-notify .admin-notify--sent')", 'статус обновлён');
    assert.equal(await page.count('.admin-order-notify .btn'), 0, 'после отправки кнопки повтора нет');
    assert.equal((await apiState()).telegram.calls, calls + 1);
    const n = (await readFullDoc(path)).notification;
    assert.deepEqual([n.status, n.attempts], ['sent', 2]);
    // Уже отправленный гостевой заказ — кнопки повтора нет
    await page.evaluate(`window.__e2eNavigate('/admin/orders/guest/${(await guestPath(guestSent.orderId)).split('/')[1]}/${guestSent.orderId}'), true`);
    await page.waitFor("document.querySelector('.admin-order-notify .admin-notify--sent')", 'отправленный заказ');
    assert.equal(await page.count('.admin-order-notify .btn'), 0);
    // Старый заказ — без данных об уведомлении, без кнопки
    await page.evaluate(`window.__e2eNavigate('/admin/orders/${uids.customer}/OLD-E2E-1'), true`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ru.orders.notify.legacy)})`, 'старый заказ');
    assert.equal(await page.count('.admin-order-notify .btn'), 0);
    await page.close();
  });

  test('16/17. обычный администратор: список и статус обычного заказа; покупатель — нет доступа к заказам', async () => {
    const page = await openAs('manager', { path: `/admin/orders/${uids.customer}/${registered.orderId}` });
    await page.waitFor("document.querySelector('#order-status')", 'карточка заказа');
    await page.evaluate(`(() => { const s = document.querySelector('#order-status'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'confirmed'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await page.click(ru.orders.saveStatus, '.admin-status-form');
    await page.waitFor("document.querySelector('.admin-page__head .order__status--confirmed')", 'статус сохранён');
    const saved = await readFullDoc(`users/${uids.customer}/orders/${registered.orderId}`);
    assert.equal(saved.status, 'confirmed');
    assert.equal(saved.userId, uids.customer);
    assert.equal(saved.total, volume.price);
    await page.evaluate("window.__e2eNavigate('/admin/orders'), true");
    await rowsCount(page, 4, 'администратор видит все заказы');
    await page.close();
    const customer = await openAs('customer', { path: '/admin/orders' });
    await customer.waitFor("document.querySelector('.admin-gate')", 'покупатель — «Нет доступа»');
    const html = await customer.evaluate('document.body.innerHTML');
    for (const o of [guestSent, guestFailed]) assert.ok(!html.includes(o.orderId), 'гостевой заказ не виден');
    await customer.close();
  });

  test('вёрстка: оформление, результат, список и карточка гостевого заказа — 320…1280 px, ru/ky/en, светлая и тёмная темы', async () => {
    const widths = [320, 375, 390, 430, 768, 1024, 1280];
    const gPath = await guestPath(guestFailed.orderId);
    const recent = JSON.stringify(JSON.stringify([guestSent]));
    const cart = JSON.stringify(JSON.stringify({ items: [{ key: `${product.id}__${volume.ml}`, id: product.id, volume: volume.ml, quantity: 1 }], promoCode: null }));
    const fits = async (page, what) => {
      for (const width of widths) {
        await page.resize(width);
        await sleep(150);
        const w = await pageWidth(page);
        assert.ok(w.sw <= w.vw + 1, `${what} ${width}px: ширина ${w.sw} > ${w.vw}`);
      }
    };
    for (const lang of ['ru', 'ky', 'en']) {
      for (const theme of ['light', 'dark']) {
        const d = dict(lang);
        const site = await openAs(null, { path: '/checkout', lang, theme, preload: `localStorage.setItem('aroma_cart', ${cart}); localStorage.setItem('aroma_recent_orders', ${recent});` });
        await site.waitFor(`document.body.innerText.includes(${JSON.stringify(d.checkout.firebaseGuestNotice)})`, `${lang}: уведомление гостя`);
        await fits(site, `${lang}/${theme} оформление`);
        await site.evaluate(`window.__e2eNavigate('/order-success/${guestSent.orderId}'), true`);
        await site.waitFor(`document.body.innerText.includes(${JSON.stringify(d.success.serverText)})`, `${lang}: результат`);
        await fits(site, `${lang}/${theme} результат`);
        await site.close();
        const admin = await openAs('owner', { path: '/admin/orders', lang, theme });
        await admin.waitFor('document.querySelectorAll(".admin-table tbody tr").length === 4', `${lang}: список`);
        assert.equal(await admin.evaluate("document.querySelector('.admin-badge--guest').innerText"), d.admin.orders.guest);
        await fits(admin, `${lang}/${theme} список заказов`);
        await admin.evaluate(`window.__e2eNavigate('/admin/orders/guest/${gPath.split('/')[1]}/${guestFailed.orderId}'), true`);
        await admin.waitFor(`document.body.innerText.includes(${JSON.stringify(d.admin.orders.notify.title)})`, `${lang}: карточка`);
        await fits(admin, `${lang}/${theme} карточка гостевого заказа`);
        await admin.close();
      }
    }
  });
});

// ---------- C3.3, этап 6: основные сценарии сайта в браузере (проверка существующих функций) ----------

describe('C3.3, этап 6: регистрация, вход и выход, каталог, избранное, корзина, отзыв, защита /admin', () => {
  const D = dict('ru');
  const setValue = (page, selector, value) =>
    page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  test('регистрация → профиль в Firestore → выход → вход тем же паролем; /admin без входа — на /login, покупателю — «Нет доступа»', async () => {
    await reseed();
    const email = `smoke-${Date.now()}@test.local`;
    const page = await openAs(null, { path: '/register' });
    await page.waitFor("document.querySelector('#reg-name')", 'форма регистрации');
    await setValue(page, '#reg-name', 'Смоук Тест');
    await setValue(page, '#reg-email', email);
    await setValue(page, '#reg-password', 'smoke-pass-123');
    await setValue(page, '#reg-confirm', 'smoke-pass-123');
    await page.evaluate("document.querySelector('form input[name=agree]').click(), true");
    await page.evaluate("document.querySelector('form button[type=submit]').click(), true");
    await page.waitFor("window.__e2ePath === '/account'", 'после регистрации — кабинет', 20000);
    const uid = await uidOf({ email, password: 'smoke-pass-123' });
    const profile = await readDoc(`users/${uid}`);
    assert.equal(profile.email, email);
    assert.deepEqual(Object.keys(profile).sort(), ['createdAt', 'email', 'name'], 'в профиле нет роли');
    assert.equal(await readDoc(`admins/${uid}`), null, 'новый пользователь — не администратор');
    // Выход
    await page.click(D.account.logout);
    await page.waitFor("window.__e2ePath !== '/account'", 'выход из кабинета');
    await page.evaluate("window.__e2eNavigate('/account'), true");
    await page.waitFor("window.__e2ePath === '/login'", 'кабинет без входа — переход на вход');
    // /admin без входа — на страницу входа
    await page.evaluate("window.__e2eNavigate('/admin/orders'), true");
    await page.waitFor("window.__e2ePath === '/login'", '/admin без входа — переход на вход');
    // Вход
    await page.waitFor("document.querySelector('#login-email')", 'форма входа');
    await setValue(page, '#login-email', email);
    await setValue(page, '#login-password', 'smoke-pass-123');
    await page.evaluate("document.querySelector('form button[type=submit]').click(), true");
    await page.waitFor("window.__e2ePath !== '/login'", 'вход выполнен', 20000);
    // Вошедший покупатель в /admin — экран «Нет доступа», данных админки нет
    await page.evaluate("window.__e2eNavigate('/admin/orders'), true");
    await page.waitFor("document.querySelector('.admin-gate')", 'покупатель — «Нет доступа»');
    assert.equal(await page.count('.admin-table'), 0);
    await page.close();
  });

  test('каталог: поиск из шапки; избранное и корзина сохраняются; отзыв уходит на модерацию и не публикуется сразу', async () => {
    await seedProducts();
    const { products } = await vite.ssrLoadModule('/src/data/products.js');
    const product = products.find((p) => p.availability === 'inStock');
    const page = await openAs(null, { path: '/' });
    // Поиск
    await page.waitFor("document.querySelector('.search__form input[type=search]')", 'поле поиска');
    await setValue(page, '.search__form input[type=search]', product.brand);
    await page.evaluate("document.querySelector('.search__form').requestSubmit(), true");
    await page.waitFor("window.__e2ePath === '/catalog' && document.querySelectorAll('.product-card').length > 0", 'результаты поиска');
    const cards = await page.evaluate("[...document.querySelectorAll('.product-card')].map((c) => c.innerText)");
    assert.ok(cards.length < products.length, `поиск сузил список: ${cards.length} из ${products.length}`);
    assert.ok(cards.some((c) => c.includes(product.name)), 'искомый товар найден');
    // Избранное
    await page.evaluate(`[...document.querySelectorAll('.product-card')].find((c) => c.innerText.includes(${JSON.stringify(product.name)})).querySelector('.fav-btn').click(), true`);
    await page.waitFor(`(localStorage.getItem('aroma_favorites') || '').includes(${JSON.stringify(product.id)})`, 'в избранном');
    await page.evaluate("window.__e2eNavigate('/favorites'), true");
    await page.waitFor("document.querySelectorAll('.favorite-row').length === 1", 'страница избранного');
    // Корзина со страницы товара
    await page.evaluate(`window.__e2eNavigate('/product/${product.id}'), true`);
    await page.waitFor(`document.querySelector('.product-info') && document.body.innerText.includes(${JSON.stringify(D.product.addToCart)})`, 'страница товара');
    await page.click(D.product.addToCart, '.product-info');
    await page.waitFor(`(localStorage.getItem('aroma_cart') || '').includes(${JSON.stringify(product.id)})`, 'в корзине');
    await page.evaluate("window.__e2eNavigate('/cart'), true");
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(product.name)})`, 'товар в корзине');
    // Отзыв
    await page.evaluate("window.__e2eNavigate('/reviews'), true");
    await page.waitFor("document.querySelector('#r-name')", 'форма отзыва');
    const text = `Смоук-отзыв ${Date.now()}: аромат понравился.`;
    await setValue(page, '#r-name', 'Смоук');
    await setValue(page, '#r-text', text);
    await page.evaluate("document.querySelector('input[name=rating][value=\"5\"]').click(), true");
    await page.evaluate("document.querySelector('#r-text').closest('form').querySelector('button[type=submit]').click(), true");
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(D.reviews.thanks)})`, 'спасибо за отзыв', 20000);
    const res = await fetch(`${DOCS}:runQuery`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'reviews' }], where: { fieldFilter: { field: { fieldPath: 'text' }, op: 'EQUAL', value: { stringValue: text } } } } }),
    });
    const found = (await res.json()).filter((r) => r.document);
    assert.equal(found.length, 1);
    assert.equal(found[0].document.fields.status.stringValue, 'pending');
    await page.evaluate("window.__e2eNavigate('/'), true");
    await page.evaluate("window.__e2eNavigate('/reviews'), true");
    await sleep(1500);
    assert.ok(!(await page.text()).includes(text), 'не опубликован до одобрения');
    await page.close();
  });
});
