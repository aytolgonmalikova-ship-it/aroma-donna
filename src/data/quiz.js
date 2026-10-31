/**
 * Вопросы теста подбора аромата.
 * Тексты вопросов и вариантов — в файлах переводов (ключи quiz.questions.*),
 * здесь только структура: id вопроса, тип (один вариант / несколько) и значения.
 */
export const QUIZ_QUESTIONS = [
  {
    id: 'category',
    type: 'single',
    options: ['women', 'men', 'unisex'],
  },
  {
    id: 'family',
    type: 'single',
    options: ['floral', 'fruity', 'oriental', 'woody', 'citrus', 'gourmand', 'aquatic', 'aromatic'],
  },
  {
    id: 'notes',
    type: 'multiple',
    min: 1,
    max: 3,
    options: ['rose', 'jasmine', 'vanilla', 'oud', 'sandalwood', 'bergamot', 'raspberry', 'lavender', 'coffee', 'seaSalt', 'iris', 'amber'],
  },
  {
    id: 'intensity',
    type: 'single',
    options: ['light', 'moderate', 'intense'],
  },
  {
    id: 'budget',
    type: 'single',
    options: ['economy', 'medium', 'premium', 'any'],
  },
];
