import { useId, useState } from 'react';
import Icon from '../common/Icon';

/**
 * Аккордеон вопросов и ответов. Одновременно открыт один пункт.
 * items: [{ q, a }]
 */
export default function FAQAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(0);
  const baseId = useId();

  return (
    <div className="accordion">
      {items.map((item, index) => {
        const open = openIndex === index;
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-btn-${index}`;
        return (
          <div key={item.q} className={`accordion__item ${open ? 'is-open' : ''}`}>
            <h3 className="accordion__heading">
              <button
                id={buttonId}
                type="button"
                className="accordion__button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex(open ? null : index)}
              >
                {item.q}
                <Icon name="plus" size={18} className="accordion__icon" />
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} className="accordion__panel" hidden={!open}>
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
