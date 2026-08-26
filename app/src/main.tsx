import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {instalarInterceptador} from './lib/api';
import './index.css';

// Precisa acontecer antes de qualquer componente montar e disparar fetch.
instalarInterceptador();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
