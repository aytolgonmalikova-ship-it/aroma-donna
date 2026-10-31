import { useTranslation } from 'react-i18next';

/** Пирамида нот: верхние, средние (сердце) и базовые ноты аромата */
export default function NotesPyramid({ notes }) {
  const { t } = useTranslation();
  const levels = ['top', 'heart', 'base'];
  return (
    <div className="notes">
      {levels.map((level) => (
        <div key={level} className={`notes__level notes__level--${level}`}>
          <h4>{t(`notes.levels.${level}`)}</h4>
          <ul>
            {notes[level].map((note) => (
              <li key={note} className="chip">
                {t(`notes.items.${note}`)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
