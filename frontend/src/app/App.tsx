import { useCallback, useMemo, useRef, useState } from 'react';

import { Moon, Settings, Sun } from 'lucide-react';

import { AppShell, type ControlesShell } from '@/app/AppShell';
import { PanelAjustes } from '@/features/ajustes/PanelAjustes';
import { usePreferencias } from '@/features/ajustes/usePreferencias';
import { PanelChat } from '@/features/chat/PanelChat';
import { PanelFuentes } from '@/features/chat/PanelFuentes';
import { useConversacion } from '@/features/chat/useConversacion';
import { ListaConversaciones } from '@/features/conversaciones/ListaConversaciones';
import { FormularioIngesta } from '@/features/documentos/FormularioIngesta';
import { ListaDocumentos } from '@/features/documentos/ListaDocumentos';
import { useIngesta } from '@/features/documentos/useIngesta';
import { IndicadorSalud } from '@/features/salud/IndicadorSalud';
import { useSalud } from '@/features/salud/useSalud';
import { PaletaComandos } from '@/features/comandos/PaletaComandos';
import type { Comando } from '@/features/comandos/comandos';
import { obtenerConversaciones } from '@/shared/api/conversaciones';
import { obtenerDocumentos } from '@/shared/api/documentos';
import { useAnuncio } from '@/shared/hooks/useAnuncio';
import { useAtajo } from '@/shared/hooks/useAtajo';
import { useRecurso } from '@/shared/hooks/useRecurso';
import { formatearFecha } from '@/shared/lib/fechas';
import { NOMBRE_TEMA, SIGUIENTE_TEMA } from '@/shared/lib/tema';
import { Anuncios } from '@/shared/ui/Anuncios';
import { useAvisos } from '@/shared/hooks/useAvisos';
import { Toasts } from '@/shared/ui/Toasts';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';

/** El simbolo del modificador segun el teclado: ⌘ en Mac, Ctrl en el resto. */
const ATAJO_PALETA =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : 'Ctrl K';

export function App() {
  const preferencias = usePreferencias();
  const conversacion = useConversacion(preferencias.consulta);

  // La sonda de salud y la lista de documentos viven aquí porque las comparten
  // la cabecera, el panel lateral y la bienvenida del chat. Una sola petición
  // de cada cosa en vez de una por consumidor.
  const { salud, comprobando } = useSalud();
  const documentos = useRecurso(obtenerDocumentos);
  // También la usa la paleta de comandos para buscar en el historial.
  const conversaciones = useRecurso(obtenerConversaciones);
  // Al terminar una ingesta se recarga la lista: el hook no la conoce, solo avisa.
  const ingesta = useIngesta(documentos.reintentar);

  // null mientras no se sabe: la bienvenida no afirma "no hay documentos"
  // hasta tener el dato, porque equivocarse ahí manda al usuario a buscar un
  // problema que no existe.
  const hayDocumentos =
    documentos.estado.fase === 'listo' ? documentos.estado.datos.length > 0 : null;

  // El estado de las citas vive aquí porque lo comparten dos zonas del layout
  // que no son parientes: el chat y el panel de fuentes. Ambas son hijas
  // directas de App, así que no hace falta contexto ni pasarlo por el shell.
  const [citaActiva, setCitaActiva] = useState<number | null>(null);
  const [citaApuntada, setCitaApuntada] = useState<number | null>(null);
  const shell = useRef<ControlesShell>(null);
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [paletaAbierta, setPaletaAbierta] = useState(false);
  const { mensaje: anuncio, anunciar } = useAnuncio();
  // `avisar` se saca del objeto a proposito: es estable, mientras que `avisos`
  // cambia con cada toast. Depender del objeto entero haria que `notificar`
  // naciese nuevo en cada render, y cualquier efecto que lo use se volveria a
  // disparar. Paso de verdad: el aviso de "respuesta lista" se realimentaba y
  // apilaba toasts sin parar.
  const { toasts, avisar, descartar } = useAvisos();

  /* Un solo sitio para decir las cosas: el toast lo ve quien mira y la region
     de anuncios lo lee quien escucha. Llamar a los dos por separado acabaria
     con mensajes que solo llegan a la mitad de la gente. */
  const notificar = useCallback(
    (texto: string, tono?: 'exito' | 'error') => {
      avisar(texto, tono);
      anunciar(texto);
    },
    [avisar, anunciar],
  );

  // Que tema se esta viendo de verdad, que con 'sistema' no es el elegido.
  const esOscuro =
    preferencias.tema === 'oscuro' ||
    (preferencias.tema === 'sistema' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches);

  const elegirCita = useCallback((numero: number) => {
    // Pulsar la cita ya activa la apaga: sirve de ida y vuelta.
    setCitaActiva((actual) => (actual === numero ? null : numero));
    shell.current?.abrirFuentes();
  }, []);

  const verDocumentos = useCallback(() => shell.current?.abrirDocumentos(), []);
  const cerrarAjustes = useCallback(() => setAjustesAbiertos(false), []);
  const cerrarPaleta = useCallback(() => setPaletaAbierta(false), []);
  const abrirPaleta = useCallback(() => setPaletaAbierta(true), []);

  // Cmd/Ctrl+K funciona también mientras se escribe: no se teclea por accidente.
  useAtajo({ tecla: 'k', conModificador: true }, abrirPaleta);

  const abrirHilo = useCallback(
    (id: number) => {
      void conversacion.abrir(id).then(() => anunciar('Conversación abierta.'));
    },
    [conversacion, anunciar],
  );

  /*
   * Lo que se esta mirando, para la barra. Tres fuentes por orden de
   * fiabilidad, y sin pedir nada al servidor:
   *
   *   1. El titulo del hilo en la lista, que es el que se puede renombrar.
   *   2. La primera pregunta del hilo abierto. Hace falta porque una
   *      conversacion recien creada todavia no esta en la lista, y caer a un
   *      generico ("Conversación") justo cuando acabas de preguntar es lo
   *      peor que puede poner ahi.
   *   3. El nombre de la aplicacion, cuando no hay conversacion.
   */
  const tituloBarra = useMemo(() => {
    const hilos =
      conversaciones.estado.fase === 'listo' ? conversaciones.estado.datos : [];
    const deLaLista = hilos.find((h) => h.id === conversacion.id)?.titulo;
    if (deLaLista) return deLaLista;

    const primera = conversacion.mensajes.find((m) => m.rol === 'usuario')?.contenido;
    if (primera) return primera;

    return 'Agent4U';
  }, [conversacion.id, conversacion.mensajes, conversaciones.estado]);

  const comandos = useMemo<Comando[]>(() => {
    const hilos =
      conversaciones.estado.fase === 'listo' ? conversaciones.estado.datos : [];

    return [
      {
        id: 'nueva',
        titulo: 'Nueva conversación',
        detalle: 'Vacía el chat para empezar de cero',
        grupo: 'Acciones',
        alias: ['empezar', 'limpiar', 'reset'],
        ejecutar: () => {
          conversacion.nueva();
          anunciar('Conversación nueva. El chat está vacío.');
        },
      },
      {
        id: 'documentos',
        titulo: 'Ir a documentos',
        detalle: 'Indexar o borrar documentos',
        grupo: 'Ir a',
        alias: ['indexar', 'subir', 'ficheros', 'pdf'],
        ejecutar: () => shell.current?.abrirDocumentos(),
      },
      {
        id: 'fuentes',
        titulo: 'Ver las fuentes',
        detalle: 'Abre el panel de la derecha',
        grupo: 'Ir a',
        alias: ['citas', 'referencias'],
        ejecutar: () => shell.current?.abrirFuentes(),
      },
      {
        id: 'ajustes',
        titulo: 'Abrir ajustes',
        detalle: 'Tema, densidad y parámetros de consulta',
        grupo: 'Ir a',
        alias: ['preferencias', 'opciones', 'config'],
        ejecutar: () => setAjustesAbiertos(true),
      },
      ...(['sistema', 'claro', 'oscuro'] as const).map((tema) => ({
        id: `tema-${tema}`,
        titulo: `Tema: ${NOMBRE_TEMA[tema].toLowerCase()}`,
        grupo: 'Apariencia' as const,
        alias: ['aspecto', 'modo', 'color'],
        ejecutar: () => preferencias.elegirTema(tema),
      })),
      // El historial entra como comandos: buscar una conversación y abrirla es
      // lo mismo que ejecutar una acción, y así se filtra con el mismo campo.
      ...hilos.map((hilo) => ({
        id: `hilo-${hilo.id}`,
        titulo: hilo.titulo,
        detalle: formatearFecha(hilo.actualizada_en),
        grupo: 'Conversaciones' as const,
        ejecutar: () => abrirHilo(hilo.id),
      })),
    ];
  }, [conversaciones.estado, conversacion, preferencias, abrirHilo, anunciar]);

  return (
    <>
      <AppShell
        ref={shell}
        acciones={
          <>
            <IconButton
              etiqueta={`Cambiar a tema ${NOMBRE_TEMA[SIGUIENTE_TEMA[preferencias.tema]].toLowerCase()}`}
              icono={esOscuro ? <Sun size={18} /> : <Moon size={18} />}
              onClick={() => preferencias.elegirTema(SIGUIENTE_TEMA[preferencias.tema])}
            />
            <IconButton
              etiqueta="Abrir los ajustes"
              icono={<Settings size={18} />}
              onClick={() => setAjustesAbiertos(true)}
            />
          </>
        }
        titulo={tituloBarra}
        indicador={<IndicadorSalud salud={salud} comprobando={comprobando} />}
        lateral={
          <div className="flex flex-col gap-3 p-2">
            {/* Lo primero de la columna y lo unico con relleno: empezar de
                cero es la accion que mas se repite. */}
            {/* Siempre activa, aunque el chat ya este vacio: empezar de cero
                es idempotente, y deshabilitar la accion mas visible de la
                columna hace que al entrar parezca que algo esta roto. */}
            {/*
              Sin icono dentro: la guia es explicita en que el sistema es
              text-first y los iconos se quedan en la barra.

              Y sin relleno: el negro solido es la unica puntuacion cromatica
              del sistema y solo puede haber UNO por pantalla. Se reserva a la
              accion del lienzo principal; aqui basta el hairline.
            */}
            <Button variante="secundario" onClick={conversacion.nueva} className="w-full">
              Nueva conversación
            </Button>

            <button
              type="button"
              onClick={abrirPaleta}
              className="flex w-full items-center justify-between rounded-full border border-borde px-4 py-2 text-start text-[0.875rem] text-suave transition-colors hover:bg-superficie-suave"
            >
              Buscar…
              <kbd className="font-mono text-[0.6875rem]">{ATAJO_PALETA}</kbd>
            </button>

            <ListaConversaciones
              estado={conversaciones.estado}
              recargar={conversaciones.reintentar}
              activa={conversacion.id}
              onAbrir={abrirHilo}
              onBorrarActiva={conversacion.nueva}
              onAvisar={notificar}
            />
          </div>
        }
        documentos={
          <div className="flex flex-col gap-4 p-4">
            <FormularioIngesta ingesta={ingesta} />
            <ListaDocumentos
              estado={documentos.estado}
              reintentar={documentos.reintentar}
              alCambiar={documentos.reintentar}
              onAvisar={notificar}
            />
          </div>
        }
        fuentes={
          <PanelFuentes
            fuentes={conversacion.fuentes}
            citaActiva={citaActiva}
            citaApuntada={citaApuntada}
            onApuntarCita={setCitaApuntada}
          />
        }
      >
        <PanelChat
          conversacion={conversacion}
          citaActiva={citaActiva}
          onElegirCita={elegirCita}
          onApuntarCita={setCitaApuntada}
          backendCaido={salud.backend === 'caido'}
          hayDocumentos={hayDocumentos}
          onVerDocumentos={verDocumentos}
          onAnunciar={anunciar}
        />
      </AppShell>

      <PanelAjustes
        abierto={ajustesAbiertos}
        alCerrar={cerrarAjustes}
        preferencias={preferencias}
      />

      <PaletaComandos
        abierta={paletaAbierta}
        alCerrar={cerrarPaleta}
        comandos={comandos}
      />

      <Toasts toasts={toasts} descartar={descartar} />
      <Anuncios mensaje={anuncio} />
    </>
  );
}
