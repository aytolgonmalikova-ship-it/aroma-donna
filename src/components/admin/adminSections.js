// Разделы админ-панели: из этого списка строятся и боковое меню, и маршруты.
// stage — этап плана, на котором раздел станет рабочим (пока показывается заглушка).
// ready — раздел уже работает (страница задана в AdminApp.jsx).
// ownerOnly — раздел виден в меню только главному администратору (Блок 2).
export const ADMIN_SECTIONS = [
  { path: 'orders', icon: 'cart', stage: 3, ready: true },
  { path: 'products', icon: 'drop', stage: 5, ready: true },
  { path: 'customers', icon: 'user', stage: 4, ready: true },
  { path: 'reviews', icon: 'star', stage: 4, ready: true },
  { path: 'admins', icon: 'shield', stage: 6, ready: true, ownerOnly: true },
];

/**
 * Виден ли раздел в меню и на главной: ownerOnly — только главному администратору
 * (access из useOwnerAccess: 'owner' | 'pending' | 'none' | 'loading' | 'error').
 * Это удобство интерфейса: доступ к странице проверяет OwnerSectionRoute, к данным — правила Firestore.
 */
export const isSectionVisible = (section, access) => !section.ownerOnly || access === 'owner';
