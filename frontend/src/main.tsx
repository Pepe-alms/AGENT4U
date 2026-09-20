import { StrictMode } from 'react';
import App from './App';
import {createRoot} from 'react-dom/client';

//https://developer.mozilla.org/es/docs/Learn_web_development/Core/Frameworks_libraries/React_getting_started

const contenedor = document.getElementById('root');
const root = createRoot(contenedor as HTMLElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
