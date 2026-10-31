import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './store/store';
import { ThemeProvider } from './hooks/useTheme';
import App from './App';
import './i18n'; // инициализация переводов (до первого рендера)
import './styles/variables.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';

/**
 * main.jsx — точка входа. Здесь React «подключается» к странице (элемент #root)
 * и приложение оборачивается в провайдеры:
 *  - Provider (Redux) — доступ к глобальному хранилищу из любого компонента;
 *  - BrowserRouter — маршрутизация по адресам;
 *  - ThemeProvider — светлая/тёмная тема.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
