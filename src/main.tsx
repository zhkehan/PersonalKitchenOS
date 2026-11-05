import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { KitchenProvider } from './ui/store';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KitchenProvider>
      <App />
    </KitchenProvider>
  </StrictMode>,
);
