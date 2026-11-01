# Админ-панель AROMA DONNA — настройка

Админ-панель открывается по адресу `/admin`. Доступ есть только у пользователей,
для которых в Firestore существует документ `admins/{uid}`.

- Проверка в интерфейсе — `src/components/admin/AdminRoute.jsx` (удобство, а не защита).
- Настоящая защита — функция `isAdmin()` в `firestore.rules` (проверяется сервером Firebase).
- В демо-режиме (без Firebase) админ-панель недоступна.

## 1. Развернуть правила Firestore

Правила в репозитории (`firestore.rules`) **не применяются автоматически**.
Перед развёртыванием сравните их с текущими правилами в
Firebase Console → Firestore Database → Rules.

Вариант А — вручную: скопируйте содержимое `firestore.rules` в Console → **Publish**.

Вариант Б — через Firebase CLI (настройки уже есть в `firebase.json` и `.firebaserc`):

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules
```

> Не запускайте `deploy --only firestore` (без `:rules`), пока `firestore.indexes.json`
> не синхронизирован с Console: сначала выполните
> `npx firebase-tools firestore:indexes > firestore.indexes.json`.

## 2. Назначить первого администратора (вручную)

1. Пользователь регистрируется на сайте обычным способом (`/register`).
2. Firebase Console → **Authentication → Users** → скопируйте его **User UID**.
3. Firebase Console → **Firestore Database → Data** → **Start collection** → ID коллекции `admins`.
4. **Document ID** — вставьте UID (именно UID, не автоматический ID!).
5. Поля (для удобства, проверка смотрит только на существование документа):
   - `email` (string) — e-mail администратора;
   - `name` (string) — имя;
   - `createdAt` (timestamp) — дата назначения.
6. **Save**. Пользователь выходит и заново входит на сайт → открывает `/admin`.

Чтобы снять права — удалите документ `admins/{uid}`.

Из браузера создать, изменить или прочитать чужой документ `admins` нельзя —
это запрещено правилами. Управление администраторами из самой панели будет сделано
позже через серверный API (Vercel Function с Firebase Admin SDK; сервисный ключ
хранится только в переменных окружения Vercel, никогда в коде клиента).

## 3. Что изменилось в правилах (этап 1)

- Администратор определяется только наличием документа `admins/{uid}`
  (функция `isAdmin()` в `firestore.rules`).
- Новая коллекция `admins/{uid}`: пользователь может прочитать (`get`) только свой документ;
  `list`, `create`, `update`, `delete` из браузера запрещены.
- `isAdmin()` пока **не даёт никаких дополнительных прав** на `users`, `orders` и `reviews`.
  Права администратора будут добавлены отдельными этапами (3–4).
- `users/{uid}` — без изменений по сравнению с опубликованными правилами:
  - читать, создавать и изменять профиль может только владелец;
  - профиль содержит только поля `name`, `email`, `createdAt` — поэтому записать себе
    роль (`role`, `isAdmin` и т.п.) невозможно;
  - `name` и `email` — строки; `createdAt` при создании ставит сервер
    (`createdAt == request.time`), при изменении его менять нельзя;
  - удаление профиля из браузера запрещено.
- `users/{uid}/orders/{orderId}` и `reviews` — без изменений.

## 4. Этап 3 — раздел «Заказы»

Страницы: `/admin/orders` (список, фильтр по статусу) и
`/admin/orders/{uid}/{orderId}` (подробности и смена статуса).

### Что изменилось в правилах

- Новое правило `match /{path=**}/orders/{orderId}` — **только чтение и только для `isAdmin()`**.
  Оно нужно для запроса `collectionGroup('orders')`, которым админка читает заказы всех покупателей.
- `users/{uid}/orders/{orderId}`:
  - `update` — только `isAdmin()` и только поля `status` и `statusUpdatedAt`;
    статус — из списка `new, confirmed, shipped, delivered, cancelled`
    (тот же список в `src/utils/orderStatus.js`, совпадение проверяет `npm test`);
    `statusUpdatedAt` ставит сервер (`serverTimestamp`). Состав, сумму, адрес и данные покупателя изменить нельзя;
  - `create` — дополнительно требуется `status == 'new'` (покупатель не может сразу создать «доставленный» заказ);
  - покупатель по-прежнему читает только свои заказы и ничего в них не меняет; `delete` запрещён всем.

### Индекс

Для сортировки по дате в запросе `collectionGroup('orders')` нужен одиночный индекс
`createdAt` (по убыванию) с областью **Collection group**. Он описан в `firestore.indexes.json`
(`fieldOverrides`). Создать его можно одним из способов:

- Firebase Console → Firestore → Indexes → **Single field** → Add exemption:
  коллекция `orders`, поле `createdAt`, включить **Descending** для **Collection group**
  (индексы для Collection не выключать);
- или `npx firebase-tools deploy --only firestore:indexes`.

Пока индекса нет, админка всё равно работает: она прочитает заказы без сортировки
и отсортирует их в браузере (в консоли будет предупреждение).

### Гостевые заказы

Заказы без входа в аккаунт в Firestore **не сохраняются** — только в `localStorage`
браузера покупателя и в сообщении Telegram. Поэтому в админке их нет.
