/**
 * Алгоритм подбора аромата.
 *
 * Это НЕ искусственный интеллект, а набор понятных правил (система баллов):
 *  - совпадение семейства ароматов ............ +40 баллов
 *  - каждая совпавшая любимая нота ............ +10 баллов (максимум +30)
 *  - совпадение интенсивности ................. +15 баллов (соседняя интенсивность +5)
 *  - совпадение категории (женский/мужской) ... +10 баллов, унисекс подходит всем (+5)
 *  - цена в выбранном бюджете ................. +15 баллов, иначе −20
 *  - нет в наличии ............................ −15 баллов
 * Товары сортируются по сумме баллов, в результат попадают лучшие.
 * Процент совпадения = баллы / максимум баллов.
 */

export const BUDGETS = {
  economy: { min: 0, max: 5000 },
  medium: { min: 5000, max: 8000 },
  premium: { min: 8000, max: Infinity },
  any: { min: 0, max: Infinity },
};

const INTENSITY_ORDER = ['light', 'moderate', 'intense'];
const MAX_SCORE = 40 + 30 + 15 + 10 + 15;

export function scoreProduct(product, answers) {
  let score = 0;
  const reasons = [];

  if (answers.family === product.fragranceFamily) {
    score += 40;
    reasons.push('family');
  }

  const allNotes = [...product.notes.top, ...product.notes.heart, ...product.notes.base];
  const matchedNotes = (answers.notes || []).filter((n) => allNotes.includes(n));
  if (matchedNotes.length) {
    score += Math.min(matchedNotes.length * 10, 30);
    reasons.push('notes');
  }

  const diff = Math.abs(
    INTENSITY_ORDER.indexOf(answers.intensity) - INTENSITY_ORDER.indexOf(product.intensity),
  );
  if (diff === 0) {
    score += 15;
    reasons.push('intensity');
  } else if (diff === 1) {
    score += 5;
  }

  if (answers.category === product.category) {
    score += 10;
    reasons.push('category');
  } else if (product.category === 'unisex' || answers.category === 'unisex') {
    score += 5;
  } else {
    score -= 10;
  }

  const budget = BUDGETS[answers.budget] || BUDGETS.any;
  if (product.price >= budget.min && product.price <= budget.max) {
    score += 15;
    reasons.push('budget');
  } else {
    score -= 20;
  }

  if (product.availability === 'outOfStock') score -= 15;

  return { score, matchedNotes, reasons };
}

export function recommendProducts(products, answers, limit = 4) {
  return products
    .map((product) => {
      const { score, matchedNotes, reasons } = scoreProduct(product, answers);
      const match = Math.max(0, Math.min(100, Math.round((score / MAX_SCORE) * 100)));
      return { product, score, match, matchedNotes, reasons };
    })
    .sort((a, b) => b.score - a.score || b.product.rating - a.product.rating)
    .slice(0, limit);
}
