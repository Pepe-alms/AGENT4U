import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Raiz } from '@/app/Raiz';
import { Animacion } from '@/shared/ui/Animacion';
import '@/shared/styles/global.css';

const contenedor = document.getElementById('root');
if (!contenedor) throw new Error('No existe el elemento #root en index.html');

createRoot(contenedor).render(
  <StrictMode>
    <Animacion>
      <Raiz />
    </Animacion>
  </StrictMode>,
);
