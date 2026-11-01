// Разделы админ-панели: из этого списка строятся и боковое меню, и маршруты.
// stage — этап плана, на котором раздел станет рабочим (пока показывается заглушка).
export const ADMIN_SECTIONS = [
  { path: 'orders', icon: 'cart', stage: 3 },
  { path: 'products', icon: 'drop', stage: 5 },
  { path: 'customers', icon: 'user', stage: 4 },
  { path: 'reviews', icon: 'star', stage: 4 },
  { path: 'admins', icon: 'shield', stage: 6 },
];
