import { lazy, Suspense, type LazyExoticComponent, type ReactElement } from 'react';

import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';

import { App } from '@/app/App';
import { RUTA_APP, rutaPorId } from '@/routes';
import { Sitio, type HandleRuta } from '@/sitio/Sitio';

/*
 * Cada pagina del sitio llega en su propio paquete. Quien entra por la portada
 * no se descarga el diagrama de arquitectura ni la rejilla de tecnologias, que
 * son las dos piezas con mas peso propio.
 */
const Inicio = lazy(() => import('@/sitio/paginas/Inicio'));
const Arquitectura = lazy(() => import('@/sitio/paginas/Arquitectura'));
const Tecnologias = lazy(() => import('@/sitio/paginas/Tecnologias'));
const NoEncontrada = lazy(() => import('@/sitio/paginas/NoEncontrada'));

/**
 * El hueco mientras llega una pagina diferida.
 *
 * Tiene la forma de una cabecera —etiqueta, titular, entradilla— para que al
 * llegar la pagina no salte el layout. Sin texto: un "Cargando..." que aparece
 * 80ms y desaparece es mas ruido que informacion. Lo que si hay es `aria-busy`
 * y un aviso para lectores de pantalla.
 */
function Cargando() {
  return (
    <div className="min-h-[70dvh] pt-16" aria-busy="true">
      <div className="flex flex-col gap-4">
        <span className="block h-3 w-24 rounded-full bg-superficie-suave" />
        <span className="block h-10 w-[min(28rem,80%)] rounded-full bg-superficie-suave" />
        <span className="block h-4 w-[min(36rem,90%)] rounded-full bg-superficie-suave" />
      </div>
      <span className="solo-lectores">Cargando la sección</span>
    </div>
  );
}

/** Envuelve una pagina diferida con su hueco de carga. */
function diferida(Pagina: LazyExoticComponent<() => ReactElement>) {
  return (
    <Suspense fallback={<Cargando />}>
      <Pagina />
    </Suspense>
  );
}

/** El `handle` que lee el layout para saber que ruta esta activa. */
const handle = (id: string): HandleRuta => ({ id });

/**
 * El reparto entre el sitio editorial y la aplicacion.
 *
 * Los `path` se leen de `src/routes.ts` en vez de escribirse aqui: asi no
 * pueden desincronizarse de la barra, el pie, las migas ni las pruebas.
 *
 * `/app` va FUERA del layout del sitio a proposito: es otro arbol, con su
 * propia barra de herramientas, y anidarlo le pondria encima la navegacion de
 * la revista.
 */
const router = createBrowserRouter([
  { path: RUTA_APP, element: <App /> },

  {
    element: <Sitio />,
    children: [
      {
        // `replace` para que la raiz no deje una entrada en el historial: sin
        // el, volver atras desde /home rebota a / y de vuelta a /home.
        path: '/',
        element: <Navigate to="/home" replace />,
      },
      {
        path: rutaPorId('home')!.path,
        element: diferida(Inicio),
        handle: handle('home'),
      },
      {
        path: rutaPorId('arquitectura')!.path,
        element: diferida(Arquitectura),
        handle: handle('arquitectura'),
        children: [
          {
            /*
             * El detalle del componente es una ruta HIJA y no una pagina
             * aparte: comparte el elemento del padre, asi que abrir un nodo no
             * vuelve a montar el diagrama. La pagina lee el parametro con
             * `useParams`.
             */
            path: ':componente',
            element: null,
            handle: handle('arquitectura-componente'),
          },
        ],
      },
      {
        path: rutaPorId('tecnologias')!.path,
        element: diferida(Tecnologias),
        handle: handle('tecnologias'),
      },
      {
        path: '*',
        element: diferida(NoEncontrada),
        handle: handle('no-encontrada'),
      },
    ],
  },
]);

export function Raiz() {
  return <RouterProvider router={router} />;
}
