// Тесты раздела «Отзывы» админ-панели (этап E4): действия модерации и JSON-копия (чистые функции),
// страница AdminReviewsPage и окно DeleteReviewDialog (по исходному тексту, как остальные страницы),
// переводы admin.reviews на ru, ky, en и стили. Запуск: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toAdminReview } from '../src/services/adminReviewsStore.js';
import {
  LONG_REVIEW_CHARS,
  REVIEW_ACTION_STATUS,
  REVIEW_BACKUP_FORMAT,
  REVIEW_FILTER_STATUSES,
  REVIEW_SORTS,
  applyReviewStatus,
  buildReviewBackup,
  isLongReview,
  removeReview,
  reviewActions,
  reviewBackupFileName,
  shouldReloadAfterError,
} from '../src/utils/adminReviews.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const keysOf = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const dicts = Object.fromEntries(['ru', 'ky', 'en'].map((l) => [l, JSON.parse(read(`src/locales/${l}/translation.json`))]));

const PAGE = 'src/pages/admin/AdminReviewsPage.jsx';
const DIALOG = 'src/components/admin/DeleteReviewDialog.jsx';
const ACTIONS = ['approve', 'reject', 'pending', 'delete'];
const ACTION_ERRORS = ['conflict', 'not-found', 'invalid', 'denied', 'network', 'not-configured', 'failed'];
const DELETE_ERRORS = ['not-rejected', 'not-found', 'denied', 'network', 'not-configured', 'failed'];
const LOAD_ERRORS = ['failed', 'network', 'denied', 'not-configured'];

const review = (id, status, extra = {}) => ({
  id,
  name: 'Айгерим',
  text: 'Очень стойкий аромат, держится весь день.',
  rating: 5,
  status,
  lang: 'ru',
  createdAt: '2026-11-01T10:00:00.000Z',
  moderatedAt: null,
  ...extra,
});

// ---------- Действия модерации ----------

test('reviewActions: только переходы в другой статус; «Удалить навсегда» — только у отклонённого', () => {
  assert.deepEqual(reviewActions('pending'), ['approve', 'reject']);
  assert.deepEqual(reviewActions('approved'), ['reject', 'pending']);
  assert.deepEqual(reviewActions('rejected'), ['approve', 'pending', 'delete']);
  for (const bad of ['published', '', undefined, null]) assert.deepEqual(reviewActions(bad), []);
  // Ни одна кнопка не ведёт в текущий статус
  for (const status of ['pending', 'approved', 'rejected']) {
    for (const action of reviewActions(status).filter((a) => a !== 'delete')) {
      assert.notEqual(REVIEW_ACTION_STATUS[action], status, `${status}: ${action}`);
    }
  }
  assert.deepEqual(REVIEW_ACTION_STATUS, { approve: 'approved', reject: 'rejected', pending: 'pending' });
});

test('shouldReloadAfterError: перечитать список после conflict, not-found, not-rejected', () => {
  for (const code of ['conflict', 'not-found', 'not-rejected']) assert.equal(shouldReloadAfterError(code), true, code);
  for (const code of ['denied', 'network', 'failed', 'invalid', 'not-configured', undefined]) {
    assert.equal(shouldReloadAfterError(code), false, String(code));
  }
});

test('isLongReview: длинный текст или больше 4 строк сворачивается', () => {
  assert.equal(isLongReview('коротко'), false);
  assert.equal(isLongReview('x'.repeat(LONG_REVIEW_CHARS)), false);
  assert.equal(isLongReview('x'.repeat(LONG_REVIEW_CHARS + 1)), true);
  assert.equal(isLongReview('1\n2\n3\n4'), false);
  assert.equal(isLongReview('1\n2\n3\n4\n5'), true);
  for (const empty of [null, undefined, '']) assert.equal(isLongReview(empty), false);
});

test('applyReviewStatus: строка обновляется сразу, исходные данные не меняются', () => {
  const data = Object.freeze({
    reviews: Object.freeze([review('a', 'pending'), review('b', 'approved', { moderatedAt: '2026-11-02T00:00:00.000Z' })]),
    invalidIds: ['bad'],
    limited: false,
  });
  const next = applyReviewStatus(data, 'a', 'approved', '2026-11-04T10:00:00.000Z');
  assert.notEqual(next, data);
  assert.deepEqual(next.reviews.map((r) => [r.id, r.status, r.moderatedAt]), [
    ['a', 'approved', '2026-11-04T10:00:00.000Z'],
    ['b', 'approved', '2026-11-02T00:00:00.000Z'],
  ]);
  assert.equal(next.reviews[1], data.reviews[1], 'другие строки — те же объекты');
  assert.equal(data.reviews[0].status, 'pending');
  // Без новой даты (ничего не записано) — дата модерации прежняя
  assert.equal(applyReviewStatus(data, 'b', 'approved').reviews[1].moderatedAt, '2026-11-02T00:00:00.000Z');
  // Нет такого отзыва или нет данных — без изменений
  assert.equal(applyReviewStatus(data, 'missing', 'approved'), data);
  assert.equal(applyReviewStatus(null, 'a', 'approved'), null);
});

test('removeReview: отзыв убирается из списка и из повреждённых', () => {
  const data = { reviews: [review('a', 'rejected'), review('b', 'pending')], invalidIds: ['a', 'bad'], limited: true };
  const next = removeReview(data, 'a');
  assert.deepEqual(next.reviews.map((r) => r.id), ['b']);
  assert.deepEqual(next.invalidIds, ['bad']);
  assert.equal(next.limited, true);
  assert.equal(data.reviews.length, 2, 'исходные данные не изменены');
  assert.equal(removeReview(null, 'a'), null);
});

test('buildReviewBackup: все поля отзыва, исходный отзыв не меняется, копия — обычный JSON', () => {
  const r = toAdminReview('rev1', {
    name: 'Айгерим',
    text: 'Роза и пион.\nДержится весь день.',
    rating: 2,
    status: 'rejected',
    lang: 'ky',
    createdAt: { toDate: () => new Date('2026-11-01T10:00:00Z') },
    moderatedAt: { toDate: () => new Date('2026-11-02T12:00:00Z') },
  });
  const before = structuredClone(r);
  const backup = buildReviewBackup(r, new Date('2026-11-04T08:30:00Z'));
  assert.deepEqual(backup, {
    format: REVIEW_BACKUP_FORMAT,
    version: 1,
    collection: 'reviews',
    id: 'rev1',
    exportedAt: '2026-11-04T08:30:00.000Z',
    document: {
      name: 'Айгерим',
      text: 'Роза и пион.\nДержится весь день.',
      rating: 2,
      status: 'rejected',
      lang: 'ky',
      createdAt: '2026-11-01T10:00:00.000Z',
      moderatedAt: '2026-11-02T12:00:00.000Z',
    },
  });
  assert.deepEqual(r, before);
  assert.deepEqual(JSON.parse(JSON.stringify(backup)), backup);
  assert.equal(buildReviewBackup(undefined, new Date(0)).id, null);
  assert.equal(reviewBackupFileName('rev1', new Date('2026-11-04T23:00:00Z')), 'review-rev1-2026-11-04.json');
});

// ---------- Переводы ----------

test('переводы admin.reviews: одинаковая структура ключей на ru, ky, en, без пустых строк', () => {
  const ruKeys = keysOf(dicts.ru.admin.reviews).sort();
  assert.ok(ruKeys.length > 100);
  for (const [lang, dict] of Object.entries(dicts)) {
    const block = dict.admin.reviews;
    assert.ok(block, lang);
    assert.deepEqual(keysOf(block).sort(), ruKeys, lang);
    for (const k of ruKeys) {
      assert.equal(typeof get(block, k), 'string', `${lang}: ${k}`);
      assert.ok(get(block, k).trim(), `${lang}: ${k} пустой`);
      // Подстановки {{…}} одинаковые во всех языках
      const ph = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();
      assert.deepEqual(ph(get(block, k)), ph(get(dicts.ru.admin.reviews, k)), `${lang}: ${k}`);
    }
  }
});

test('переводы admin.reviews: статусы, фильтры, действия, ошибки, удаление, пустой список и поиск', () => {
  for (const [lang, dict] of Object.entries(dicts)) {
    const b = dict.admin.reviews;
    REVIEW_FILTER_STATUSES.forEach((s) => {
      assert.ok(b.status[s], `${lang}: status.${s}`);
      assert.ok(b.emptyStatus[s], `${lang}: emptyStatus.${s}`);
    });
    ['pending', 'approved', 'rejected'].forEach((s) => {
      assert.ok(b.statusBadge[s] && b.statusHint[s] && b.done[s], `${lang}: ${s}`);
      assert.match(b.done[s], /\{\{name\}\}/, `${lang}: done.${s}`);
    });
    REVIEW_SORTS.forEach((s) => assert.ok(b.sort[s], `${lang}: sort.${s}`));
    ACTIONS.forEach((a) => {
      assert.ok(b.action[a], `${lang}: action.${a}`);
      assert.match(b.actionLabel[a], /\{\{name\}\}/, `${lang}: actionLabel.${a}`);
    });
    ['approve', 'reject', 'pending'].forEach((a) => assert.ok(b.busy[a], `${lang}: busy.${a}`));
    LOAD_ERRORS.forEach((e) => assert.ok(b.errors[e], `${lang}: errors.${e}`));
    ACTION_ERRORS.forEach((e) => assert.ok(b.actionErrors[e], `${lang}: actionErrors.${e}`));
    ACTION_ERRORS.filter((e) => e !== 'not-configured').forEach((e) =>
      assert.match(b.actionErrors[e], /\{\{name\}\}/, `${lang}: actionErrors.${e}`),
    );
    DELETE_ERRORS.forEach((e) => assert.ok(b.delete.errors[e], `${lang}: delete.errors.${e}`));
    assert.match(b.delete.done, /\{\{name\}\}/, lang);
    assert.match(b.delete.downloaded, /\{\{file\}\}/, lang);
    assert.match(b.limited, /\{\{count\}\}/, lang);
    assert.match(b.found, /\{\{count\}\}.*\{\{total\}\}|\{\{total\}\}.*\{\{count\}\}/, lang);
    // Ошибка прав подсказывает про правила этапа D
    assert.match(b.errors.denied, /D/, lang);
  }
});

test('страница и окно: все ключи переводов есть в ru, ky и en', () => {
  const src = read(PAGE) + read(DIALOG);
  const keys = new Set([...src.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)].map((m) => m[1]));
  // Ключи с подстановкой (`...${v}`) — перечисляем явно
  REVIEW_FILTER_STATUSES.forEach((s) => keys.add(`admin.reviews.status.${s}`).add(`admin.reviews.emptyStatus.${s}`));
  ['pending', 'approved', 'rejected'].forEach((s) =>
    keys.add(`admin.reviews.statusBadge.${s}`).add(`admin.reviews.statusHint.${s}`).add(`admin.reviews.done.${s}`),
  );
  ['ru', 'ky', 'en'].forEach((l) => keys.add(`admin.reviews.lang.${l}`));
  REVIEW_SORTS.forEach((s) => keys.add(`admin.reviews.sort.${s}`));
  ACTIONS.forEach((a) => keys.add(`admin.reviews.action.${a}`).add(`admin.reviews.actionLabel.${a}`));
  ['approve', 'reject', 'pending'].forEach((a) => keys.add(`admin.reviews.busy.${a}`));
  LOAD_ERRORS.forEach((e) => keys.add(`admin.reviews.errors.${e}`));
  ACTION_ERRORS.forEach((e) => keys.add(`admin.reviews.actionErrors.${e}`));
  DELETE_ERRORS.forEach((e) => keys.add(`admin.reviews.delete.errors.${e}`));
  assert.ok(keys.size > 80, `ключей: ${keys.size}`);
  for (const [lang, dict] of Object.entries(dicts)) {
    const missing = [...keys].filter((k) => typeof get(dict, k) !== 'string');
    assert.deepEqual(missing, [], lang);
  }
  // Все шаблонные ключи страницы перечислены выше
  const dynamic = [...src.matchAll(/t\(`(admin\.reviews\.[a-zA-Z.]+)\$\{/g)].map((m) => m[1]);
  const covered = ['status.', 'emptyStatus.', 'statusBadge.', 'statusHint.', 'done.', 'lang.', 'sort.', 'action.', 'actionLabel.', 'busy.', 'errors.', 'actionErrors.', 'delete.errors.'];
  dynamic.forEach((d) => assert.ok(covered.some((c) => d === `admin.reviews.${c}`), d));
});

// ---------- Страница ----------

test('страница: фильтры в адресе, по умолчанию — ожидающие, вкладки со счётчиками', () => {
  const page = read(PAGE);
  assert.match(page, /parseReviewListParams\(searchParams\)/);
  assert.match(page, /setSearchParams\(toReviewListParams\(\{ \.\.\.filters, \.\.\.next \}\), \{ replace: true \}\)/);
  assert.match(page, /REVIEW_FILTER_STATUSES\.map\(/);
  assert.match(page, /aria-pressed=\{filters\.status === s\}/);
  assert.match(page, /counts\[s\]/);
  assert.match(page, /countReviewsByStatus\(reviews\)/);
  assert.match(page, /applyReviewFilters\(reviews, filters\)/);
  // Поиск, оценка 1–5, сортировка по дате, сброс
  assert.match(page, /type="search"/);
  assert.match(page, /onChange=\{\(e\) => setFilters\(\{ q: e\.target\.value \}\)\}/);
  assert.match(page, /REVIEW_RATINGS/);
  assert.match(page, /key === 'rating' \? \(v \? Number\(v\) : null\) : v/);
  assert.match(page, /REVIEW_SORTS/);
  assert.match(page, /onClick=\{resetFilters\}/);
});

test('страница: карточка — имя, оценка, текст, язык, дата, статус, дата модерации; длинный текст сворачивается', () => {
  const page = read(PAGE);
  for (const part of [
    /\{r\.name\}/,
    /<RatingStars value=\{r\.rating\}/,
    /\{r\.text\}/,
    /admin\.reviews\.lang\.\$\{r\.lang\}/,
    /formatDate\(r\.createdAt, lang\)/,
    /admin-badge admin-badge--\$\{r\.status\}/,
    /formatDate\(r\.moderatedAt, lang\)/,
    /t\('admin\.reviews\.notModerated'\)/,
    /t\('admin\.reviews\.noDate'\)/,
  ]) {
    assert.match(page, part);
  }
  assert.match(page, /const long = isLongReview\(r\.text\)/);
  assert.match(page, /admin-review__text\$\{collapsed \? ' is-collapsed' : ''\}/);
  assert.match(page, /aria-expanded=\{!collapsed\}/);
  assert.match(page, /aria-controls=\{textId\}/);
});

test('страница: модерация через setReviewStatus с загруженным статусом, одно действие за раз, затем перезагрузка', () => {
  const page = read(PAGE);
  assert.match(page, /fetchAllReviews\(\)/);
  assert.match(page, /await setReviewStatus\(review\.id, status, review\.status\)/);
  assert.match(page, /const status = REVIEW_ACTION_STATUS\[action\]/);
  assert.match(page, /reviewActions\(r\.status\)\.map/);
  // Повторные нажатия: проверка в обработчике и disabled у всех кнопок действий
  assert.match(page, /const locked = Boolean\(busy\) \|\| deleting \|\| refreshing;/);
  assert.equal(page.match(/if \(locked\) return;/g).length, 2, 'handleStatus и openDelete');
  assert.match(page, /disabled=\{locked\}/);
  assert.match(page, /aria-busy=\{isBusy \|\| undefined\}/);
  assert.match(page, /aria-label=\{t\(`admin\.reviews\.actionLabel\.\$\{action\}`, \{ name: review\.name \}\)\}/);
  // После действия — перечитать список; ошибки — с именем отзыва; conflict и др. — тоже перечитать
  assert.match(page, /await load\(\{ silent: true \}\);\n {4}\} catch/);
  assert.match(page, /setActionError\(\{ name: review\.name, code \}\)/);
  assert.match(page, /if \(shouldReloadAfterError\(code\)\) await load\(\{ silent: true \}\)/);
  assert.match(page, /res\.changed \? `admin\.reviews\.done\.\$\{status\}` : 'admin\.reviews\.unchanged'/);
  // Устаревший ответ загрузки не применяется
  assert.match(page, /const request = \+\+requestRef\.current;/);
  assert.match(page, /request === requestRef\.current && setData\(res\)/);
});

test('страница: удаление — только через окно, только для отклонённых, deleteReview один раз', () => {
  const page = read(PAGE);
  assert.equal(page.match(/deleteReview\(/g).length, 1);
  assert.match(page, /await deleteReview\(review\.id\)/);
  assert.match(page, /action === 'delete' \? openDelete\(review\) : handleStatus\(review, action\)/);
  assert.match(page, /<DeleteReviewDialog/);
  assert.match(page, /onConfirm=\{handleDelete\}/);
  assert.match(page, /onCancel=\{closeDelete\}/);
  assert.match(page, /setData\(\(d\) => removeReview\(d, review\.id\)\)/);
  assert.match(page, /if \(shouldReloadAfterError\(code\)\) load\(\{ silent: true \}\)/);
  // После удаления фокус — на заголовок раздела (кнопки «Удалить» уже нет)
  assert.match(page, /headingRef\.current\?\.focus\(\)/);
  assert.match(page, /<h1 ref=\{headingRef\} tabIndex=\{-1\}>/);
  // Кнопка удаления есть только у отклонённых — reviewActions
  assert.deepEqual(['pending', 'approved'].map((s) => reviewActions(s).includes('delete')), [false, false]);
});

test('страница: загрузка, ошибка, пусто, ничего не найдено, обновление, лимит и повреждённые документы', () => {
  const page = read(PAGE);
  assert.match(page, /\{!error && !data && <LoadingSpinner \/>\}/);
  assert.match(page, /<ErrorMessage\s+message=\{t\(`admin\.reviews\.errors\.\$\{error\}`/);
  assert.match(page, /onRetry=\{\(\) => load\(\{ silent: Boolean\(data\) \}\)\}/);
  assert.match(page, /data && reviews\.length === 0/);
  assert.match(page, /t\('admin\.reviews\.empty'\)/);
  assert.match(page, /t\('admin\.reviews\.emptyFiltered'\)/);
  assert.match(page, /t\(`admin\.reviews\.emptyStatus\.\$\{filters\.status\}`\)/);
  assert.match(page, /refreshing \? t\('admin\.reviews\.refreshing'\)/);
  assert.match(page, /data\?\.limited &&/);
  assert.match(page, /t\('admin\.reviews\.limited', \{ count: ADMIN_REVIEWS_LIMIT \}\)/);
  assert.match(page, /data\?\.invalidIds\.length > 0 &&/);
  assert.match(page, /<code>\{id\}<\/code>/);
});

test('страница и окно: без dangerouslySetInnerHTML и innerHTML', () => {
  for (const file of [PAGE, DIALOG, 'src/utils/adminReviews.js', 'src/services/adminReviewsStore.js']) {
    assert.doesNotMatch(read(file), /dangerouslySetInnerHTML|innerHTML/, file);
  }
});

// ---------- Подключение раздела (этап E5) ----------

test('подключение: раздел «Отзывы» готов в adminSections и открывает AdminReviewsPage через SECTION_PAGES', async () => {
  const { ADMIN_SECTIONS } = await import('../src/components/admin/adminSections.js');
  const reviews = ADMIN_SECTIONS.find((s) => s.path === 'reviews');
  assert.deepEqual(reviews, { path: 'reviews', icon: 'star', stage: 4, ready: true });
  // Формат остальных разделов не изменился, порядок меню прежний
  assert.deepEqual(ADMIN_SECTIONS.map((s) => [s.path, s.icon, Boolean(s.ready)]), [
    ['orders', 'cart', true],
    ['products', 'drop', true],
    ['customers', 'user', true],
    ['reviews', 'star', true],
    ['admins', 'shield', true],
  ]);
  const app = read('src/pages/admin/AdminApp.jsx');
  assert.match(app, /import AdminReviewsPage from '\.\/AdminReviewsPage';/);
  const pages = app.slice(app.indexOf('const SECTION_PAGES = {'), app.indexOf('};', app.indexOf('const SECTION_PAGES = {')));
  assert.deepEqual([...pages.matchAll(/(\w+): (\w+),/g)].map((m) => [m[1], m[2]]), [
    ['orders', 'AdminOrdersPage'],
    ['customers', 'AdminCustomersPage'],
    ['products', 'AdminProductsPage'],
    ['reviews', 'AdminReviewsPage'],
    ['admins', 'AdminAdminsSection'],
  ]);
  // Каждый готовый раздел (ready) имеет страницу, неготовый — заглушку; страница отзывов — только через SECTION_PAGES
  for (const s of ADMIN_SECTIONS) assert.equal(pages.includes(`${s.path}:`), Boolean(s.ready), s.path);
  // Отдельного маршрута в обход общего списка разделов нет
  assert.doesNotMatch(app, /<AdminReviewsPage|path="reviews/);
  assert.match(app, /path=\{s\.path\} element=\{Page \? <Page \/> : <AdminSectionPage section=\{s\} \/>\}/);
});

test('подключение: маршрут внутри AdminRoute и AdminLayout, пункт меню /admin/reviews с подсветкой активного раздела', () => {
  const app = read('src/pages/admin/AdminApp.jsx');
  // Проверка прав и макет не изменились: все разделы — внутри <AdminRoute> и <Route element={<AdminLayout />}>
  // Блок 2: между AdminRoute и Routes — AdminRoleScope (роль владельца для меню и раздела «Администраторы»)
  assert.match(app, /<AdminRoute>\s*<AdminRoleScope>\s*<Routes>\s*<Route element=\{<AdminLayout \/>\}>/);
  assert.ok(app.indexOf('ADMIN_SECTIONS.map') > app.indexOf('<AdminRoute>'));
  assert.ok(app.indexOf('ADMIN_SECTIONS.map') < app.indexOf('</AdminRoute>'));
  // Админ-панель по-прежнему загружается отдельным файлом только по адресу /admin/*
  const root = read('src/App.jsx');
  assert.match(root, /const AdminApp = lazy\(\(\) => import\('\.\/pages\/admin\/AdminApp'\)\);/);
  assert.match(root, /path="admin\/\*"/);
  // Меню: NavLink на /admin/<path> — класс active ставит React Router, стиль .admin__link.active есть
  const layout = read('src/layouts/AdminLayout.jsx');
  assert.match(layout, /<NavLink key=\{s\.path\} to=\{`\/admin\/\$\{s\.path\}`\} className="admin__link">/);
  assert.match(read('src/styles/admin.css'), /\.admin__link\.active \{/);
  // Право администратора: admins/{uid}; без него — экран «Нет доступа», без входа — /login
  const route = read('src/components/admin/AdminRoute.jsx');
  assert.match(route, /useAdminAccess\(current\)/);
  assert.match(route, /if \(!current\) return <Navigate to="\/login"/);
  assert.match(route, /if \(status !== 'admin'\) \{/);
  // На главной админки раздел помечен «Готово» (badge по флагу ready)
  assert.match(read('src/pages/admin/AdminDashboardPage.jsx'), /s\.ready \? t\('admin\.ready'\)/);
});

// ---------- Окно удаления ----------

test('окно удаления: JSON-копия и флажок обязательны, после not-rejected и not-found кнопка заблокирована', () => {
  const dialog = read(DIALOG);
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby="delete-review-title"/);
  assert.match(dialog, /aria-describedby="delete-review-text"/);
  assert.match(dialog, /const blockedByError = Boolean\(error\) && shouldReloadAfterError\(error\);/);
  assert.match(dialog, /const canDelete = downloaded && understood && !deleting && !blockedByError;/);
  assert.match(dialog, /disabled=\{!canDelete\}/);
  assert.match(dialog, /if \(canDelete\) onConfirm\(\)/);
  assert.match(dialog, /buildReviewBackup\(review\)/);
  assert.match(dialog, /reviewBackupFileName\(review\.id\)/);
  assert.match(dialog, /type="checkbox"/);
  // Имя, оценка, дата, ID и текст отзыва на виду
  assert.match(dialog, /\{review\.name/);
  assert.match(dialog, /<RatingStars value=\{review\.rating\}/);
  assert.match(dialog, /<code>\{review\.id\}<\/code>/);
  assert.match(dialog, /\{review\.text\}/);
});

test('окно удаления: фокус на «Отмене», Escape закрывает (кроме момента удаления), Tab не выходит из окна', () => {
  const dialog = read(DIALOG);
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  assert.match(dialog, /ref=\{cancelRef\}/);
  assert.match(dialog, /e\.key === 'Escape'/);
  assert.match(dialog, /if \(!deleting\) onCancel\(\)/);
  assert.match(dialog, /e\.target === e\.currentTarget && !deleting && onCancel\(\)/);
  assert.match(dialog, /const outside = !dialogRef\.current\.contains\(document\.activeElement\)/);
  assert.match(dialog, /e\.shiftKey && \(document\.activeElement === first \|\| outside\)/);
  assert.match(dialog, /!e\.shiftKey && \(document\.activeElement === last \|\| outside\)/);
  assert.match(dialog, /errorRef\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /role="alert" tabIndex=\{-1\}/);
  // Фокус возвращается на кнопку, открывшую окно; прокрутка страницы блокируется и восстанавливается
  assert.match(dialog, /if \(opener instanceof HTMLElement && opener\.isConnected\) opener\.focus\(\)/);
  assert.match(dialog, /document\.body\.style\.overflow = prevOverflow/);
  // Во время удаления кнопки заблокированы
  assert.match(dialog, /onClick=\{onCancel\} disabled=\{deleting\}/);
  assert.match(dialog, /aria-busy=\{deleting \|\| undefined\}/);
});

// ---------- Стили ----------

test('стили: все классы страницы и окна есть в CSS; цвета — только переменные темы (светлая и тёмная)', () => {
  const css = ['admin', 'pages', 'components', 'base', 'layout'].map((f) => read(`src/styles/${f}.css`)).join('\n');
  const src = read(PAGE) + read(DIALOG);
  const classes = new Set(
    [...src.matchAll(/className=\{?[`"]([^`"]+)[`"]/g)]
      .flatMap((m) => m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/))
      .filter((c) => /^[a-z][a-z0-9_-]*$/.test(c) && !c.endsWith('-') && !c.endsWith('--')),
  );
  ['admin-badge--pending', 'admin-badge--approved', 'admin-badge--rejected', 'admin-review--pending', 'admin-review--approved', 'admin-review--rejected'].forEach(
    (c) => classes.add(c),
  );
  assert.ok(classes.size > 25, `классов: ${classes.size}`);
  // admin-delete-dialog__overlay — метка фона окна, как у окна удаления товара (оформление — payment-modal-overlay)
  classes.delete('admin-delete-dialog__overlay');
  assert.match(read('src/components/admin/DeleteProductDialog.jsx'), /admin-delete-dialog__overlay/);
  const missing = [...classes].filter((c) => !new RegExp(`\\.${c}(?![a-z0-9_-])`).test(css));
  assert.deepEqual(missing, []);
  const admin = read('src/styles/admin.css');
  const block = admin.slice(admin.indexOf('/* ---------- Отзывы: модерация (этап E) ---------- */'));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const dark = read('src/styles/variables.css').slice(read('src/styles/variables.css').indexOf("[data-theme='dark']"));
  ['--warning', '--warning-bg', '--success', '--success-bg', '--error', '--error-bg', '--border-strong', '--bg-alt'].forEach((v) =>
    assert.match(dark, new RegExp(`${v}:`), `dark ${v}`),
  );
  // Узкий экран: длинные слова и ссылки переносятся, кнопки переносятся на новую строку
  assert.match(block, /\.admin-review__text \{[^}]*overflow-wrap: anywhere;/);
  assert.match(block, /\.admin-review__text \{[^}]*white-space: pre-wrap;/);
  assert.match(block, /\.admin-review__actions \{[^}]*flex-wrap: wrap;/);
});

// ---------- Адаптивная вёрстка (этап E6) ----------

test('адаптивность: каркас админки не шире экрана — колонки minmax(0, 1fr), меню сжимается', () => {
  const css = read('src/styles/admin.css');
  // Компьютер: меню 248px, содержимое — остаток ширины, не шире
  assert.match(css, /\.admin \{\s*display: grid;[^}]*grid-template-columns: 248px minmax\(0, 1fr\);/);
  // До 899px: одна колонка с экран; без minmax(0, …) она росла до ширины ленты меню (816px на телефоне)
  const tablet = css.slice(css.indexOf('@media (max-width: 899px)'));
  assert.match(tablet, /\.admin \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/);
  assert.match(tablet, /\.admin__sidebar \{\s*min-width: 0;/);
  assert.match(tablet, /\.admin__nav \{[^}]*overflow-x: auto;/);
  assert.match(css, /\.admin__body \{[^}]*min-width: 0;/);
});

test('адаптивность: раздел «Отзывы» — обёртка .admin-reviews, сжимаемые карточки и правила для телефонов', () => {
  assert.match(read(PAGE), /<div className="admin-reviews">/);
  const css = read('src/styles/admin.css');
  const block = css.slice(css.indexOf('/* ---------- Отзывы: узкие экраны'));
  assert.ok(block.length > 500);
  assert.match(block, /\.admin-reviews__list \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(block, /\.admin-review > \*,/);
  // Окно удаления отзыва: кнопки не переносятся «столбиками» (общее правило до 640px — column-reverse + wrap)
  assert.match(block, /\.admin-reviews \.admin-delete-dialog__actions \{\s*flex-wrap: nowrap;/);
  assert.match(block, /\.admin-reviews \.admin-delete-dialog__actions \.btn \{\s*flex: 0 1 auto;/);
  // Телефоны (до 560px; планшет 768px — обычный вид в одну строку)
  const phone = block.slice(block.indexOf('@media (max-width: 560px)'));
  assert.ok(block.includes('@media (max-width: 560px)'));
  assert.match(phone, /\.admin-reviews \.admin-filters \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(phone, /\.admin-reviews \.admin-toolbar \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(phone, /\.admin-reviews \.admin-toolbar__search \{[^}]*max-width: none;/);
  assert.match(phone, /\.admin-reviews \.admin-toolbar__sort \.field__control \{[^}]*width: 100%;/);
  assert.match(phone, /\.admin-review__actions \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(120px, 1fr\)\);/);
  assert.match(phone, /\.admin-review__actions \.btn \{[^}]*white-space: normal;/);
  assert.match(phone, /\.admin-review__actions \.admin-review__delete \{\s*grid-column: 1 \/ -1;/);
  // Правила телефона — только внутри раздела отзывов: стили заказов и товаров не затронуты
  for (const m of phone.matchAll(/^\s{2}(\.[^{]+)\{/gm)) {
    assert.match(m[1], /^\.admin-review/, m[1].trim());
  }
  // Последний блок @media (max-width: 640px) по-прежнему — окно удаления товара (tests/adminProducts.test.js)
  assert.match(css.slice(css.lastIndexOf('@media (max-width: 640px)')), /\.admin-delete-dialog__actions \{\s*flex-direction: column-reverse;/);
});

// ---------- Документация (этап E7) ----------

test('ADMIN_SETUP.md и README: раздел модерации описан так, как он устроен в коде', async () => {
  const { ADMIN_REVIEWS_LIMIT } = await import('../src/services/adminReviewsStore.js');
  const doc = read('docs/ADMIN_SETUP.md');
  const e = doc.slice(doc.indexOf('## 11. Раздел «Отзывы» в админ-панели (этап E)'));
  assert.ok(e.length > 2000, 'раздел 11 есть');
  for (const heading of [
    '### Статусы',
    '### Просмотр и фильтры',
    '### Повреждённые документы',
    '### Одобрение, отклонение и возврат в ожидание',
    '### Окончательное удаление',
    '### Права доступа',
    '### Ограничения',
    '## 12. Проверка модерации на эмуляторах Firebase (без рабочей базы)',
    '### Защита от подключения к рабочей базе',
    '### Результаты проверок этапа E',
  ]) {
    assert.ok(e.includes(heading), heading);
  }
  // Подписи в документации совпадают с интерфейсом (ru)
  const r = dicts.ru.admin.reviews;
  for (const label of [
    ...Object.values(r.status),
    ...Object.values(r.action),
    ...Object.values(r.statusBadge),
    ...Object.values(r.sort),
    r.ratingLabel,
    r.showMore,
    r.delete.title,
    r.delete.download,
    r.delete.confirmCheck,
    dicts.ru.admin.deniedTitle,
  ]) {
    assert.ok(e.includes(`«${label}`), label);
  }
  // Числа и форматы — из кода
  assert.ok(e.includes(`limit(${ADMIN_REVIEWS_LIMIT})`));
  assert.ok(e.includes(`Показаны последние ${ADMIN_REVIEWS_LIMIT} отзывов`));
  assert.ok(e.includes(`формат \`${REVIEW_BACKUP_FORMAT}\``));
  assert.ok(e.includes(`${LONG_REVIEW_CHARS} символов`));
  assert.equal(reviewBackupFileName('<id>', new Date('2026-11-05T00:00:00Z')), 'review-<id>-2026-11-05.json');
  assert.ok(e.includes('`review-<id>-<ГГГГ-ММ-ДД>.json`'));
  // Повреждённые документы не входят в счётчики — это сказано явно
  assert.match(e, /не входят в список карточек и ни в один счётчик/);
  // Команды из документации существуют
  const { scripts } = JSON.parse(read('package.json'));
  for (const cmd of ['emulators:dev', 'seed:emulator', 'dev:emulator', 'test:rules']) {
    assert.ok(e.includes(`npm run ${cmd}`), cmd);
    assert.ok(scripts[cmd], `package.json: ${cmd}`);
  }
  assert.ok(e.includes('http://127.0.0.1:5174') && scripts['dev:emulator'].includes('--port 5174'));
  // Устаревшие утверждения убраны
  assert.doesNotMatch(doc, /до появления раздела в админ-панели|Раздел модерации в админ-панели — следующий этап|В Firebase они ещё\s+не опубликованы/);
  const readme = read('README.md');
  assert.doesNotMatch(readme, /Пока раздела модерации в админ-панели нет|изменять и удалять — нельзя \(см\. выше\)/);
  for (const cmd of ['emulators:dev', 'seed:emulator', 'dev:emulator']) assert.ok(readme.includes(`npm run ${cmd}`), `README: ${cmd}`);
  assert.ok(readme.includes('/admin/reviews'));
});
