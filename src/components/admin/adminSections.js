// Разделы админ-панели: из этого списка строятся и боковое меню, и маршруты.
// stage — этап плана, на котором раздел станет рабочим (пока показывается заглушка).
// ready — раздел уже работает (страница задана в AdminApp.jsx).
// «Товары»: на этапе 5а страница есть (источник каталога и импорт), ready — после этапа 5б.
export const ADMIN_SECTIONS = [
  { path: 'orders', icon: 'cart', stage: 3, ready: true },
  { path: 'products', icon: 'drop', stage: 5 },
  { path: 'customers', icon: 'user', stage: 4, ready: true },
  { path: 'reviews', icon: 'star', stage: 4 },
  { path: 'admins', icon: 'shield', stage: 6 },
];
