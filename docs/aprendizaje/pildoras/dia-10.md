# Píldora 10 — Persistencia con SQLAlchemy

**Sábado 7-nov-2026 · sesión larga: 30 min de lectura + 2-2,5 h de ejercicio**

## 0. Crítica de la entrega del día 09

No hay entrega del día 09: en `origin/aprendizaje` no existe `entregas/dia-09.md` y en el remoto no hay ninguna rama `ejercicio/dia-*`. Tampoco han llegado tarde las anteriores (02 a 08). Sin nota.

Hoy vuelve a ser un ejercicio **sin Docker, sin modelos y sin clave de Gemini**: `uv sync`, pytest, la CLI de `sqlite3` (viene con macOS) y un servidor de demostración que monta los routers reales sobre una BD de usar y tirar. Si quieres recuperar el 09, no choca con este: el 09 toca `query_service.py`, `schemas.py` y `query.py`, y hoy tocas `db/` y `tests/`.

`main` sigue en `fb93eea` (21-oct). Todo lo que sigue lo he comprobado hoy ejecutando ese código con las versiones que fija `backend/uv.lock` (`sqlalchemy 2.0.52`, `fastapi 0.139.2`) y SQLite 3.53. Las salidas que verás pegadas son reales.

---

## 1. Concepto clave: el ORM no es "SQL con clases"

### 1.1 Las cuatro piezas de SQLAlchemy

SQLAlchemy tiene muchas capas. En AGENT4U solo se usan cuatro, y conviene tener claro qué hace cada una:

| Pieza | Qué es | En AGENT4U |
|---|---|---|
| **Engine** | La fábrica de conexiones. Sabe hablar con el driver (`sqlite3`) y guarda un **pool** de conexiones abiertas. Se crea una vez por proceso. | `engine` en `db/session.py:14-17` |
| **Session** | Una "unidad de trabajo": agrupa lo que lees y lo que cambias, y lo manda a la BD en una transacción al hacer `commit()`. Es barata, se crea y se tira por petición. | `SessionLocal()` y `get_db()` |
| **Modelo declarativo** | Una clase Python que describe una tabla: columnas, claves, relaciones. | `Document`, `Conversacion`, `Mensaje` en `db/models/` |
| **`select()` / `update()`** | El constructor de consultas al estilo 2.0. Se ejecuta con `db.scalar()`, `db.scalars()` o `db.execute()`. | Todo `db/crud/`, salvo una función |

La idea que más cuesta interiorizar: **la `Session` no es una conexión**. Es una libreta en la que SQLAlchemy apunta los objetos que ha cargado y los cambios que has hecho. Pide una conexión al pool cuando necesita hablar con la BD y la devuelve al terminar la transacción (`commit`, `rollback` o `close`).

### 1.2 Lo que hace la Session por debajo

Tres mecanismos explican el 90 % de las sorpresas:

- **Identity map.** Dentro de una sesión, cada fila existe **una sola vez** como objeto Python. Si pides dos veces `Document` con id 3, recibes *el mismo objeto*. Y si otra sesión cambia esa fila, la tuya no se entera: SQLAlchemy no sobrescribe atributos que ya tiene cargados hasta que los "expiras".
- **Expiración.** Por defecto, un `commit()` marca todos los objetos de la sesión como caducados: el siguiente acceso a un atributo relanza un `SELECT`. Es la forma de "enterarse" de los cambios ajenos. El precio: si la sesión ya está cerrada cuando accedes, no hay con qué relanzar el `SELECT` y salta `DetachedInstanceError`.
- **Flush.** Lo que haces con `db.add()` o al cambiar un atributo no va a la BD en ese momento. Se guarda como pendiente y se escribe en el *flush*, que ocurre en el `commit()`, en un `flush()` explícito o, si `autoflush=True`, antes de cada consulta.

### 1.3 SQLite: una base de datos que es un fichero

SQLite no es un servidor: es una librería C que lee y escribe un fichero. Eso tiene consecuencias que en Postgres no existen:

- **Un solo escritor a la vez.** Si dos conexiones escriben a la vez, la segunda espera al cerrojo o falla con `database is locked`. El `timeout` del driver es cuánto espera.
- **WAL** (*write-ahead log*). En el modo por defecto (`journal_mode=delete`), un escritor bloquea también a los lectores. En WAL, los cambios van a un fichero aparte (`.db-wal`), los lectores siguen leyendo la versión anterior y solo los escritores compiten entre sí. Es un ajuste **persistente**: se guarda en el propio fichero.
- **Las claves foráneas vienen apagadas.** Por compatibilidad con versiones de hace 20 años, SQLite **ignora** `FOREIGN KEY` y `ON DELETE CASCADE` salvo que cada conexión ejecute `PRAGMA foreign_keys=ON`. Es un ajuste **por conexión**, no persistente. Retén esta frase, porque es el segundo bug de hoy.
- **Tipos laxos.** Una columna `DATETIME` guarda texto (`'2026-11-07 07:20:47.056146'`) y una `JSON` también. SQLAlchemy convierte en ambos sentidos.

---

## 2. Cómo está en AGENT4U

### 2.1 Tres tablas, un fichero, dos procesos

```text
            ┌──────────── /data/agent4u.db (volumen api_data) ────────────┐
            │                                                             │
            │  conversaciones 1 ───< mensajes            documents        │
            │  id (5 cifras, aleatorio)  conversacion_id  id (autoinc.)   │
            │  titulo, usuario           rol, contenido   origin (UNIQUE) │
            │  creada_en, actualizada_en fuentes (JSON)   name, state     │
            │                            creado_en        job_id, ...     │
            └───────────▲──────────────────────────────────────▲──────────┘
                        │                                      │
        api (FastAPI): conversaciones, mensajes,     worker (ARQ): marca
        documentos en-cola, cupo, /trabajos          indexando/indexado/error
```

En `docker-compose.yml`, `api` y `worker` montan el **mismo** volumen `api_data:/data` con `APP_DB_URL: sqlite:////data/agent4u.db` (cuatro barras: `sqlite:///` y la ruta absoluta `/data/...`). En tu Mac, sin Docker, el valor por defecto de `config.py:12` es `sqlite:///./agent4u.db`, relativo al directorio desde el que arrancas (por eso `.gitignore` tiene `agent4u.db*`).

11 de las 14 operaciones de la API reciben una sesión por `Depends(get_db)`: las 4 de conversaciones, las 2 de documentos, las 3 de indexación, `/trabajos/{id}` y `/preguntar`. Las dos de salud y la de `/ajustes` no tocan la BD.

### 2.2 `db/session.py`: el motor, la fábrica y la dependencia

```python
settings = get_settings()

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False, "timeout": 30},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def crear_esquema() -> None:
    Base.metadata.create_all(engine)
    if "sqlite" in settings.db_url:
        with engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Línea a línea:

- **El motor se crea al importar el módulo** (`:12-17`), con la configuración de ese momento. Por eso, para apuntar a otra BD, hay que poner `APP_DB_URL` **antes** de arrancar el proceso: cambiarla después no sirve de nada. Lo usarás hoy.
- **`check_same_thread: False`.** El driver `sqlite3` de Python, por defecto, se niega a usar una conexión desde un hilo distinto del que la creó. FastAPI ejecuta los endpoints `def` en un pool de hilos y el pool de SQLAlchemy reparte conexiones entre ellos, así que esa comprobación rompería todo. Desactivarla es seguro *porque* el pool garantiza que una conexión no la usan dos hilos a la vez.
- **`timeout: 30`.** Es el `busy_timeout` de SQLite: 30 s esperando al cerrojo de escritura antes de lanzar `database is locked`. Llegó con `fb93eea`, junto con el WAL, cuando entró el worker: desde ese día hay dos procesos escribiendo en el mismo fichero.
- **El pool es un `QueuePool`** (lo comprobé: `type(engine.pool).__name__ == 'QueuePool'`), con los valores por defecto de SQLAlchemy 2.0: 5 conexiones fijas y 10 de desborde.
- **`autoflush=False`.** Una consulta no escribe antes lo pendiente. Más predecible, pero obliga a recordar que lo que has hecho `add()` sin `commit()` **no aparece** en tus propias consultas (lo verás en el laboratorio).
- **`expire_on_commit=False`.** Tras el `commit`, los objetos conservan sus valores. El día 04 viste el motivo general. El caso que lo hace imprescindible es el del día 08: `query_service.responder` lee el `historial` (objetos `Mensaje`), hace `commit` al guardar la pregunta y después mete esos objetos en el estado del grafo, que los lee cuando ya nadie garantiza que la sesión siga viva. Con `True`, cada `m.rol` necesitaría un `SELECT`, y fuera de la sesión eso es `DetachedInstanceError`. Lo medí con el laboratorio de hoy:

  ```text
  expire_on_commit=False -> cap.pdf
  expire_on_commit=True -> DetachedInstanceError
  ```

- **`crear_esquema()`** lo llama el `lifespan` (`lifespan.py:61`). `create_all` crea las tablas **que no existen** y no toca las que ya existen. Vuelve a esto en el apartado 3.
- **`get_db()`** es una dependencia con `yield`: FastAPI abre la sesión, se la pasa al endpoint y ejecuta el `finally` al terminar la petición. Con FastAPI 0.139 eso ocurre **después** de enviar la respuesta (lo mediste el día 09). Matiz importante: una sesión abierta no retiene conexión. Tras cada `commit` la conexión vuelve al pool, así que la sesión que `/preguntar` mantiene abierta durante el stream no ocupa una de las 15.

Hay una línea de este fichero que parece inocente y no lo es (`:7`):

```python
# El modelo de conversaciones registra sus tablas en el mismo Base al importarse.
from app.db.models import conversation as _conversation_models  # noqa: F401
```

`Base.metadata` solo conoce las tablas de los modelos **que se han importado**. Si nadie importa `models/conversation.py` antes de `create_all`, la tabla `conversaciones` no se crea. Es un efecto secundario de importar, y el `tests/conftest.py:21` tiene que repetir el mismo truco. Hoy vas a añadir otro del mismo tipo, y verás por qué es frágil.

### 2.3 Los modelos

`db/models/document.py` define `Base` y `Document`. `db/models/conversation.py` importa `Base` de ahí y define las otras dos:

```python
def id_5_cifras() -> int:
    """Id aleatorio de 5 cifras (10000-99999), no enumerable."""
    return 10000 + secrets.randbelow(90000)


class Conversacion(Base):
    __tablename__ = "conversaciones"

    id: Mapped[int] = mapped_column(primary_key=True, default=id_5_cifras)
    ...
    actualizada_en: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.now, onupdate=datetime.datetime.now
    )

    mensajes: Mapped[list["Mensaje"]] = relationship(
        back_populates="conversacion",
        cascade="all, delete-orphan",
        order_by="Mensaje.creado_en",
    )

class Mensaje(Base):
    __tablename__ = "mensajes"
    ...
    conversacion_id: Mapped[int] = mapped_column(
        ForeignKey("conversaciones.id", ondelete="CASCADE")
    )
    fuentes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    ...

Index("ix_mensajes_conv_fecha", Mensaje.conversacion_id, Mensaje.creado_en)
```

Lo que conviene saber de cada pieza:

- **`Mapped[...]` + `mapped_column`** es el estilo tipado de SQLAlchemy 2.0. El tipo de Python decide la nulabilidad: `Mapped[str]` es `NOT NULL` y `Mapped[str | None]` admite `NULL`. Lo puedes ver en el `CREATE TABLE` real (`rol VARCHAR(16) NOT NULL`, `fuentes JSON` sin `NOT NULL`).
- **`default=` y `onupdate=`** son valores **del lado de Python**: SQLAlchemy llama a la función al construir el `INSERT` o el `UPDATE` de *esa* fila. No hay ningún `DEFAULT` ni trigger en la tabla. Quédate con lo de "de esa fila".
- **El id de la conversación** es aleatorio desde `1f63aaa` (9-sep), y de ahí sale el `62473` del día 09. Si sale uno repetido, el `INSERT` falla por clave primaria y `crear_conversacion` (`crud/conversation.py:11-22`) reintenta hasta 5 veces.
- **Dos cascadas distintas.** `cascade="all, delete-orphan"` es del **ORM**: cuando haces `db.delete(conv)`, SQLAlchemy carga los mensajes y los borra él. `ondelete="CASCADE"` es de la **BD**: lo haría SQLite... si tuviera las claves foráneas encendidas.
- **`order_by="Mensaje.creado_en"`** en la relación: `conv.mensajes` siempre sale ordenado. El índice compuesto `(conversacion_id, creado_en)` sirve justo a esa consulta y a `obtener_ultimos_mensajes`.
- **`fuentes` es JSON**: cada respuesta guarda una foto de los fragmentos que la sustentaron, con su texto. Es lo que permite reabrir una conversación antigua y ver sus fuentes aunque el documento ya no exista.

### 2.4 El CRUD: cada función es su propia transacción

Todas las funciones de `db/crud/` siguen el mismo patrón: reciben la sesión, hacen su cambio y **hacen `commit()` ellas mismas**:

```python
def anadir_mensaje(db: Session, conversacion_id: int, rol: str,
                   contenido: str, fuentes: list | None = None) -> Mensaje:
    mensaje = Mensaje(
        conversacion_id=conversacion_id,
        rol=rol,
        contenido=contenido,
        fuentes=fuentes,
    )
    db.add(mensaje)
    db.commit()
    return mensaje
```

Es cómodo y difícil de olvidar, pero tiene un coste: dos operaciones del CRUD **nunca** pueden ir en la misma transacción. `query_service.responder` (`:54-56`) crea la conversación (commit) y guarda la pregunta (otro commit). `_encolar_trabajo` (`routers/indexation.py:51-69`) inserta la fila `en-cola` (commit) y **después** encola en Redis. Si Redis falla entre medias, la fila se queda `en-cola` para siempre y ocupa cupo: el fantasma del día 05 tiene aquí su raíz.

La función más trabajada es `renombrar_conversacion` (`:35-57`). Su docstring explica algo fino: reasignar `actualizada_en` con su mismo valor no sirve, porque SQLAlchemy no lo ve como cambio, no lo mete en el `SET` y entonces el `onupdate` lo pisa. La solución es un `UPDATE` explícito que nombra la columna en `values()`. Es correcto... y protege un valor que, como vas a ver, nunca cambia.

### 2.5 Quién abre sesiones y cuándo

| Dónde | Cómo | Por qué así |
|---|---|---|
| Los 11 endpoints | `Depends(get_db)` | Una sesión por petición, cerrada por FastAPI |
| `rag/streaming.py:67-71` | `with SessionLocal() as sesion:` | Guarda la respuesta cuando el stream termina. La sesión de la petición no está pensada para eso. |
| `services/cola_arq.py:34-35` | `with SessionLocal()` dentro de `async def en_vuelo` | El cupo cuenta filas `en-cola`/`indexando` |
| `worker/jobs.py:34-41` y `:67-76` | Dos `with SessionLocal()` separados, uno al empezar y otro al terminar | Entre medias pasan minutos de Docling. No se retiene nada durante ese tiempo y solo viaja el `doc_id` (un entero), no el objeto. |
| `services/indexation_service.py:12-39` | `_marcar_estado` con sesión propia | Su docstring cuenta la historia: un PDF de 176 páginas seguía vectorizando a los 90 minutos, con la petición muerta desde el minuto 10 |

El patrón "pasa el entero, no el objeto" aparece tres veces (`query_service.py:57-58`, `indexation_service.py:57-59` y el worker). Es la regla buena: un objeto ORM pertenece a una sesión, y fuera de ella es un objeto zombi.

### 2.6 Cómo lo aíslan los tests

`tests/conftest.py:30-43` crea un motor `sqlite://` (en memoria) con `StaticPool`, porque cada conexión a `:memory:` es una BD distinta y vacía: con un pool normal, cada sesión vería su propia base vacía. Y `nunca_la_base_de_datos_real` (`:75-101`, *autouse*) sustituye el `SessionLocal` global en los cuatro módulos que lo usan. Su docstring merece leerse: un test llegó a marcar como `error` el documento 1 **real** de `agent4u.db`.

El otro docstring que enseña algo es el de `documentos_frescos` (`:57-72`): el test leía `'pendiente'` cuando la BD decía `'error'`. Es el identity map de 1.2 en acción, y hoy lo vas a reproducir.

### 2.7 De la fila a la pantalla

```text
conversaciones.actualizada_en
  → GET /conversaciones (ORDER BY actualizada_en DESC LIMIT 20)  crud/conversation.py:27-33
  → ConversacionResumenOut (schemas.py:398)  "2026-11-07T07:20:47.056146"
  → gateway: ConversacionResumen.actualizada_en: str (gateway/app/schema/types.py)
  → frontend: agruparPorFecha(..., c => c.actualizada_en)   ListaConversaciones.tsx:110
  → "Hoy" / "Ayer" / "Últimos 7 días" y la hora corta de cada fila   :185-188
```

La lista lateral de la UI **ordena y agrupa** por `actualizada_en`. Con eso en la cabeza, lee el primer punto del apartado siguiente.

---

## 3. Por qué se montó así (y qué no cuadra)

### Decisiones

1. **SQLite y no Postgres.** Es un proyecto de un usuario (`usuario="local"` está escrito a fuego en el router), los datos relacionales son pocos (conversaciones y estados de ingesta) y lo pesado vive en Qdrant. SQLite no necesita un séptimo servicio, ni credenciales, ni copias de seguridad aparte: es un fichero en un volumen. *Coste:* un solo escritor. El día que entró el worker hubo que añadir WAL y `timeout`, y SQLite sobre un volumen compartido solo funciona porque los dos contenedores están en el mismo host. Con dos máquinas, o con un disco de red, se acaba la fiesta.

2. **SQLAlchemy ORM y no SQL a mano.** Los modelos dan tipos (`Mapped[str]`), las relaciones (`conv.mensajes` ordenado) y `from_attributes=True` en Pydantic convierte un objeto ORM en JSON sin código intermedio. Además, cambiar a Postgres sería, en teoría, cambiar la URL. *Coste:* la Session tiene semántica propia (identity map, expiración, flush) que hay que aprender, y ya ha mordido dos veces, según cuentan los docstrings de los tests.

3. **Sesión por petición + sesiones propias para lo que sobrevive a la petición.** Es el patrón canónico, y está bien aplicado: nadie se lleva una sesión de petición a un hilo largo.

4. **`expire_on_commit=False` global.** Necesario por cómo viajan los objetos (2.2). *Coste:* puedes leer datos rancios sin darte cuenta; es lo que pasó en `documentos_frescos`.

5. **Ids de conversación aleatorios de 5 cifras.** Son cortos y legibles en los logs y en el `conversacion_id` que viaja en cada `/preguntar`, y no revelan cuántas conversaciones hay. Hoy no aparecen en ninguna URL: el frontend los usa como `key` de React y para marcar el hilo activo (`App.tsx:246`). *Coste:* hay 90 000 en total. Con 1 000 conversaciones, cada alta choca un 1,1 % de las veces, y el reintento lo absorbe. Con 45 000 conversaciones, la mitad de los intentos chocan. Y "no enumerable" es exagerar: 90 000 peticiones se recorren en minutos. Sin autenticación, da igual. Con usuarios reales, la protección tiene que venir de la autorización, no del id.

6. **El CRUD hace `commit`.** Simple para un CRUD pequeño. *Coste:* las transacciones las decide la capa equivocada (2.4).

7. **`create_all` y no migraciones.** Cero ceremonia mientras el esquema cambia cada semana. *Coste:* ver el 🟠 de migraciones.

### Cosas que no cuadran (comprobadas hoy contra `main`)

- 🔴 **`actualizada_en` no se actualiza nunca al conversar.** El `onupdate` salta cuando se hace un `UPDATE` de **la fila de `conversaciones`**, pero `anadir_mensaje` solo inserta en `mensajes`. Nadie toca la fila de la conversación. Y la única operación que sí la actualiza, `renombrar_conversacion`, desactiva el `onupdate` a propósito. Resultado: `actualizada_en` vale siempre lo mismo que `creada_en`, con una diferencia de microsegundos entre las dos llamadas a `now()`. Lo medí con dos conversaciones, *CAP* y después *Raft*, y un mensaje nuevo en *CAP* al final:

  ```text
  GET /conversaciones
    61228  Raft en dos frases        actualizada_en 07:20:48.061810
    16816  ¿Qué es el teorema CAP?   actualizada_en 07:20:47.056146   ← la última en la que escribiste
  ```

  En la UI, una conversación que retomas hoy sigue en *"Ayer"* o en *"Últimos 7 días"*, y la lista está ordenada por fecha de creación aunque la descripción del endpoint dice *"ordenadas por fecha de ultima actualizacion"*. Y como el `LIMIT 20` corta por esa fecha, una conversación antigua que sigues usando acaba desapareciendo de la lista. Ningún test lo cubre: `tests/api/test_conversations.py` tiene 5 tests y ninguno mira fechas ni orden. **Lo arreglas hoy.**

- 🔴 **Las claves foráneas están apagadas.** `PRAGMA foreign_keys` devuelve `0` en las conexiones de la app. Consecuencias medidas: se puede guardar un mensaje de la conversación `12345678`, que no existe, sin ningún error, y un borrado en bloque (`delete(Conversacion)` o un `DELETE` desde la CLI) deja los mensajes huérfanos, porque `ondelete="CASCADE"` no hace nada. El borrado normal funciona solo porque la cascada del ORM hace el trabajo: lo vi en el SQL, `SELECT conversaciones…`, `SELECT mensajes…`, `DELETE FROM mensajes`, `DELETE FROM conversaciones`. **Lo arreglas hoy.**

- 🟠 **Sin migraciones, el esquema solo crece en BDs nuevas.** `job_id` llegó con `fb93eea` (21-oct). Con una `agent4u.db` de antes, `create_all` no añade la columna (no toca tablas existentes), y el primer `GET /documentos` revienta:

  ```text
  OperationalError (sqlite3.OperationalError) no such column: documents.job_id
  ```

  Lo reproduje creando la tabla con el esquema anterior. La salida de hoy fue borrar la BD. El día que haya datos que no quieras perder, hará falta **Alembic** (el sistema de migraciones de SQLAlchemy): cada cambio de esquema se convierte en un script versionado `upgrade`/`downgrade`.

- 🟠 **Fechas sin zona horaria.** Todas las columnas usan `datetime.datetime.now` (hora local, sin zona), y la API las serializa sin sufijo: `"2026-11-07T07:20:47.056146"`. En Docker, la imagen `python:3.12-slim` no define `TZ`, así que esa hora es UTC. El navegador interpreta una fecha ISO sin zona **como hora local**: `new Date("2026-11-07T07:20:47")` en Madrid es `07:20 GMT+0100`, una hora antes de la real (dos en verano). En tu Mac, sin Docker, sale bien, y por eso no se ve. Además, cerca de medianoche, el grupo *Hoy*/*Ayer* sale mal. La solución estándar: `datetime.now(datetime.UTC)`, `DateTime(timezone=True)` y que la API emita `+00:00`.

- 🟠 **`DELETE /documentos/{nombre}` borra por nombre, que no es único.** Ya salió el día 04 y sigue igual. Lo reproduje: con `/a/informe.pdf` y `/b/informe.pdf` se borra una fila y queda la otra. Hay un efecto peor que entonces no se vio: `borrar_por_origen` filtra en Qdrant por `origen == nombre` **o** `nombre == nombre`, así que borra los vectores **de los dos**. Queda una fila `indexado` sin un solo vector detrás.

- 🟡 **`fuentes = None` se guarda como el texto `'null'`, no como `NULL`.** La columna `JSON` de SQLAlchemy, por defecto, serializa `None` a JSON. En la CLI, `length(fuentes)` da `4` en los mensajes de usuario, y un `WHERE fuentes IS NULL` no encuentra ninguno. Para que no pase, `JSON(none_as_null=True)`.

- 🟡 **`crear_conversacion` reintenta ante cualquier `IntegrityError`**, no solo ante un id repetido. Un `NOT NULL` violado se reintentaría 5 veces y acabaría en un `RuntimeError` que habla de ids. Además, el `rollback` descarta también cualquier otro cambio pendiente que tuviera la sesión.

- 🟡 **SQL síncrono dentro de `async def`.** `_comprobar_cupo` → `ColaArq.en_vuelo()` y `_encolar_trabajo` son corrutinas que hacen consultas bloqueantes. Normalmente tardan microsegundos, pero si el worker tiene el cerrojo de escritura pueden llegar a los 30 s del `timeout`, con el *event loop* entero parado (incluido `/health`). Es el mismo error que `indexation_service` documenta como prohibido.

- 🟡 **Código y columnas muertos.** `hash_content` (con índice) y `Document.user` no los escribe ni los lee nadie. `crear_documento`, `marcar_*` desde `indexar_documento` y el estado `'pendiente'` solo existen para los scripts de evaluación y para los tests: en producción todo entra por `crear_documento_encolado`. `contar_en_vuelo` usa `db.query(...)`, el estilo 1.x que SQLAlchemy 2.0 considera *legacy*, y es la única función que lo hace.

- 🟡 **La convención de nombres no se cumple aquí.** El `README.md:162` dice que los nombres en inglés son solo los "ligados a una convención externa (`Document` como modelo SQLAlchemy)". Pero `Conversacion` y `Mensaje` también son modelos SQLAlchemy y están en español, con columnas en español (`creada_en`). `Document` tiene columnas en inglés (`created_at`, `state`). Dentro de `db/` conviven las dos lenguas sin regla.

- 🟡 **`Base` vive en `models/document.py`.** Para declarar una conversación hay que importar el módulo de documentos. Lo normal es un `db/base.py` del que dependan todos los modelos.

---

## 4. Ejercicio (2-2,5 h): mira las tablas por dentro y arregla las dos 🔴

**Rama de código:** `ejercicio/dia-10`, creada desde `main`.
**Entrega:** `docs/aprendizaje/entregas/dia-10.md`, en la rama `aprendizaje`, **antes de las 8:30 del lunes 9-nov**.

Vas a: (1) sembrar una BD de demostración con el CRUD real y abrirla con `sqlite3`; (2) ver el SQL que lanza cada endpoint y relacionar cada columna con lo que pinta la UI; (3) reproducir en un laboratorio el identity map, la expiración y el autoflush; (4) escribir **primero** 5 tests, 4 en rojo; (5) arreglar `actualizada_en` y las claves foráneas; (6) comprobar el arreglo en la BD de demostración y en tu `agent4u.db` real.

### Paso 1 — Rama y punto de partida (5 min)

```bash
cd ~/ruta/AGENT4U
git fetch origin
git switch -c ejercicio/dia-10 origin/main
cd backend
uv sync
uv run pytest -q          # punto de partida: 91 passed
sqlite3 --version         # viene con macOS; si no, usa: uv run python -m sqlite3
```

### Paso 2 — Una BD de demostración, sembrada con el CRUD real (25 min)

Los scripts van **fuera del repo**, en `/tmp/agent4u-bd`, para que no acaben en el commit:

```bash
mkdir -p /tmp/agent4u-bd
cat > /tmp/agent4u-bd/sembrar.py <<'EOF'
"""Rellena una BD de usar y tirar con el CRUD REAL de AGENT4U."""
import time
import uuid

from app.db.crud import conversation as cc
from app.db.crud import document as dc
from app.db.session import SessionLocal, crear_esquema

crear_esquema()
with SessionLocal() as s:
    # Dos conversaciones: primero "CAP", un segundo después "Raft".
    cap = cc.crear_conversacion(s, titulo="¿Qué es el teorema CAP?", usuario="local")
    cc.anadir_mensaje(s, cap.id, "user", "¿Qué es el teorema CAP?")
    cc.anadir_mensaje(s, cap.id, "assistant", "Que no puedes tenerlo todo.",
                      fuentes=[{"nombre": "cap.pdf", "origen": "/docs/cap.pdf", "headings": ["CAP"],
                                "paginas": [7], "texto": "El teorema CAP dice que...",
                                "score": 2.0, "subconsulta": "¿Qué es CAP?"}])
    time.sleep(1)
    raft = cc.crear_conversacion(s, titulo="Raft en dos frases", usuario="local")
    cc.anadir_mensaje(s, raft.id, "user", "Raft en dos frases")
    time.sleep(1)
    # Vuelves a la conversación de CAP: es la ÚLTIMA en la que has escrito.
    cc.anadir_mensaje(s, cap.id, "user", "¿Y qué pasa con la latencia?")

    # Tres documentos, uno por estado.
    a = dc.crear_documento_encolado(s, "/uploads/cap.pdf", "cap.pdf", "pdf", 120_000, str(uuid.uuid4()))
    dc.marcar_indexado(s, a, 42)
    b = dc.crear_documento_encolado(s, "/uploads/raft.pdf", "raft.pdf", "pdf", 80_000, str(uuid.uuid4()))
    dc.marcar_error(s, b, "docling: PDF cifrado")
    dc.crear_documento_encolado(s, "/uploads/paxos.pdf", "paxos.pdf", "pdf", 50_000, "trabajo-de-prueba")

    print(f"CAP = {cap.id} · Raft = {raft.id}")
EOF

export APP_DB_URL=sqlite:////tmp/agent4u-bd/demo.db     # 4 barras: ruta absoluta
rm -f /tmp/agent4u-bd/demo.db*
PYTHONPATH=. uv run python /tmp/agent4u-bd/sembrar.py   # anota los dos ids
ls /tmp/agent4u-bd/
```

`export` hace que `APP_DB_URL` valga para todos los comandos de **esta** terminal. Si abres otra, repítelo. ¿Ves `demo.db-wal` y `demo.db-shm` junto a `demo.db`? Si no, aparecen mientras haya una conexión abierta.

Ahora ábrela con la CLI y lanza estas consultas una a una. Pega cada salida en la entrega:

```bash
sqlite3 -header -column /tmp/agent4u-bd/demo.db
```

```sql
.tables
.schema mensajes
.indexes
PRAGMA journal_mode;
PRAGMA foreign_keys;

-- Lo que manda la API a la lista lateral (mismo ORDER BY que crud/conversation.py:31)
SELECT id, titulo, creada_en, actualizada_en FROM conversaciones ORDER BY actualizada_en DESC;

-- La actividad REAL de cada conversación
SELECT c.id, c.titulo, MAX(m.creado_en) AS ultimo_mensaje
FROM conversaciones c JOIN mensajes m ON m.conversacion_id = c.id
GROUP BY c.id ORDER BY ultimo_mensaje DESC;

-- Lo que hay dentro de la columna JSON
SELECT id, rol, json_extract(fuentes, '$[0].nombre') AS primera_fuente, fuentes, length(fuentes)
FROM mensajes;
SELECT COUNT(*) FROM mensajes WHERE fuentes IS NULL;

SELECT id, name, state, num_chunks, job_id, error_message FROM documents;
```

Y ahora rompe la integridad a propósito, desde la CLI:

```sql
INSERT INTO mensajes (conversacion_id, rol, contenido, creado_en)
VALUES (99999, 'user', 'huérfano', datetime('now'));
PRAGMA foreign_key_check;          -- ¿qué fila lista?
PRAGMA foreign_keys = ON;          -- solo para ESTA conexión
INSERT INTO mensajes (conversacion_id, rol, contenido, creado_en)
VALUES (99998, 'user', 'otro', datetime('now'));   -- ¿y ahora?
DELETE FROM mensajes WHERE conversacion_id IN (99998, 99999);
.quit
```

Lo que deberías ver: `wal` y `0` en los dos `PRAGMA`; *Raft* encima de *CAP* en la primera consulta y *CAP* encima en la segunda; `'null'` con `length = 4` en los mensajes de usuario y `0` en el `IS NULL`; la fila `(mensajes, 5, conversaciones, 0)` en `foreign_key_check`; y `FOREIGN KEY constraint failed` en el segundo `INSERT`.

### Paso 3 — El SQL de cada endpoint y su sitio en la UI (25 min)

Un servidor que monta **los routers reales** de conversaciones, documentos y trabajos, con `echo=True` para que cada consulta salga en la terminal:

```bash
cat > /tmp/agent4u-bd/servidor.py <<'EOF'
"""Los routers REALES de conversaciones, documentos y trabajos, sin modelos ni Qdrant."""
from fastapi import FastAPI

from app.api.routers import conversations, documents, jobs
from app.db.session import engine

engine.echo = True   # cada SQL que lanza SQLAlchemy sale en esta terminal

app = FastAPI()
app.include_router(conversations.router)
app.include_router(documents.router)
app.include_router(jobs.router)
app.state.qdrant = None   # solo lo usa DELETE /documentos, que hoy no tocas
EOF

# Terminal 1, desde backend/:
export APP_DB_URL=sqlite:////tmp/agent4u-bd/demo.db
PYTHONPATH=/tmp/agent4u-bd:. uv run uvicorn servidor:app --port 8001
```

En la terminal 2, cada llamada y, después, lo que ha salido en la terminal 1 (sustituye `<CAP>` por tu id):

```bash
curl -s localhost:8001/conversaciones | python3 -m json.tool
curl -s localhost:8001/conversaciones/<CAP> | python3 -m json.tool
curl -s localhost:8001/documentos | python3 -m json.tool
curl -s localhost:8001/trabajos/trabajo-de-prueba | python3 -m json.tool
curl -s -X PATCH localhost:8001/conversaciones/<CAP> \
     -H 'content-type: application/json' -d '{"titulo": "CAP renombrada"}' | python3 -m json.tool
curl -s localhost:8001/conversaciones | python3 -m json.tool      # ¿ha cambiado el orden?
```

Fíjate en tres cosas del log:

1. `GET /conversaciones/<CAP>` lanza **dos** `SELECT`: uno de la conversación y otro de `mensajes … ORDER BY mensajes.creado_en`. El segundo no lo escribió nadie en el CRUD. ¿Quién lo lanza y en qué momento? Pista: `relationship` es *lazy* por defecto.
2. Cada petición termina con `ROLLBACK`. Es el `db.close()` de `get_db` cerrando una transacción que solo leía: no se ha deshecho nada.
3. El `PATCH` lanza `UPDATE conversaciones SET titulo=?, actualizada_en=?` con la fecha **antigua**: es el truco de `renombrar_conversacion`.

Con eso, completa en la entrega esta tabla (las dos primeras filas van de ejemplo). La columna *UI* sale de `frontend/src/features/conversaciones/ListaConversaciones.tsx`, `features/chat/` y `features/documentos/`. Si tienes la pila levantada, compruébalo en pantalla.

| Lo que ves en la UI | Campo GraphQL | Columna SQLite | Quién la escribe (fichero:línea) |
|---|---|---|---|
| Orden de la lista lateral y grupo *Hoy/Ayer* | `conversaciones { actualizada_en }` | `conversaciones.actualizada_en` | `default`/`onupdate` en `models/conversation.py:24-26` y `renombrar_conversacion` |
| El hilo marcado como activo en la lista | `conversaciones { id }` | `conversaciones.id` | `id_5_cifras`, `models/conversation.py:10-12` |
| Título de cada hilo | | | |
| Burbujas del hilo y su orden | | | |
| Panel de fuentes de una respuesta antigua | | | |
| Estado de un documento en la lista | | | |
| Número de fragmentos del documento | | | |
| Mensaje de error de una ingesta fallida | | | |

### Paso 4 — Laboratorio: identity map, expiración y autoflush (15 min)

Con el servidor parado (`Ctrl+C`) y `APP_DB_URL` todavía exportada:

```bash
cat > /tmp/agent4u-bd/laboratorio.py <<'EOF'
"""Tres comportamientos de la sesión de SQLAlchemy, medidos sobre la BD de demo."""
from sqlalchemy.orm import sessionmaker

from app.db.crud import document as dc
from app.db.models.document import Document
from app.db.session import SessionLocal, engine

print("1) Identity map: dos sesiones, la misma fila")
with SessionLocal() as a:
    doc_a = a.get(Document, 3)                       # paxos.pdf, en-cola
    with SessionLocal() as b:                        # como el worker
        dc.marcar_error(b, b.get(Document, 3), "lo marcó otra sesión")
    print("   a.get otra vez   ->", a.get(Document, 3).state)       # ¿?
    a.expire_all()
    print("   tras expire_all  ->", a.get(Document, 3).state)
    print("   ¿mismo objeto?   ->", doc_a is a.get(Document, 3))

print("2) expire_on_commit")
for valor in (False, True):
    Sesion = sessionmaker(bind=engine, autoflush=False, expire_on_commit=valor)
    with Sesion() as s:
        doc = s.get(Document, 1)
        dc.marcar_indexado(s, doc, 42)               # hace commit
    try:
        print(f"   expire_on_commit={valor} -> {doc.name}")
    except Exception as e:
        print(f"   expire_on_commit={valor} -> {type(e).__name__}")

print("3) Autoflush apagado")
with SessionLocal() as s:
    s.add(Document(origin="/uploads/nuevo.pdf", name="nuevo.pdf", type="pdf"))
    print("   documentos antes de flush:", len(dc.listar_documentos(s)))
    s.flush()
    print("   después de flush:        ", len(dc.listar_documentos(s)))
    s.rollback()
EOF
PYTHONPATH=. uv run python /tmp/agent4u-bd/laboratorio.py
```

Salida esperada:

```text
1) Identity map: dos sesiones, la misma fila
   a.get otra vez   -> en-cola
   tras expire_all  -> error
   ¿mismo objeto?   -> True
2) expire_on_commit
   expire_on_commit=False -> cap.pdf
   expire_on_commit=True -> DetachedInstanceError
3) Autoflush apagado
   documentos antes de flush: 3
   después de flush:         4
```

Relaciona el bloque 1 con el docstring de `documentos_frescos` (`tests/conftest.py:57-72`) y el 2 con `query_service.py:55-60`.

### Paso 5 — Los tests primero, en rojo (20 min)

Crea `backend/tests/unit/test_conversation_crud.py`. Hoy no existe ningún test unitario del CRUD de conversaciones:

```python
"""Persistencia de conversaciones: lo que la lista de la UI da por hecho."""

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.db.crud import conversation as conversation_crud
from app.db.models.conversation import Conversacion, Mensaje


def test_anadir_mensaje_actualiza_la_fecha_de_la_conversacion(db):
    conv = conversation_crud.crear_conversacion(db, titulo="vieja", usuario="local")
    antes = conv.actualizada_en

    mensaje = conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido="hola")

    db.expire_all()  # leer de la BD, no del identity map
    despues = db.get(Conversacion, conv.id).actualizada_en
    assert despues > antes
    assert despues == mensaje.creado_en


def test_la_conversacion_con_actividad_sube_al_principio(db):
    vieja = conversation_crud.crear_conversacion(db, titulo="vieja", usuario="local")
    nueva = conversation_crud.crear_conversacion(db, titulo="nueva", usuario="local")

    conversation_crud.anadir_mensaje(db, vieja.id, rol="user", contenido="sigo aqui")

    db.expire_all()
    ids = [c.id for c in conversation_crud.listar_conversaciones(db, usuario="local")]
    assert ids == [vieja.id, nueva.id]


def test_renombrar_no_cambia_la_fecha(db):
    conv = conversation_crud.crear_conversacion(db, titulo="a", usuario="local")
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido="hola")
    db.expire_all()
    antes = db.get(Conversacion, conv.id).actualizada_en

    conversation_crud.renombrar_conversacion(db, conv.id, "b")

    db.expire_all()
    conv = db.get(Conversacion, conv.id)
    assert conv.titulo == "b"
    assert conv.actualizada_en == antes


def test_no_se_puede_guardar_un_mensaje_sin_conversacion(db):
    with pytest.raises(IntegrityError):
        conversation_crud.anadir_mensaje(db, 999999, rol="user", contenido="huerfano")


def test_borrado_masivo_arrastra_los_mensajes(db):
    conv = conversation_crud.crear_conversacion(db, titulo="x", usuario="local")
    conversation_crud.anadir_mensaje(db, conv.id, rol="user", contenido="hola")

    db.execute(delete(Conversacion).where(Conversacion.id == conv.id))
    db.commit()

    huerfanos = db.scalar(
        select(func.count()).select_from(Mensaje).where(Mensaje.conversacion_id == conv.id)
    )
    assert huerfanos == 0
```

```bash
uv run pytest -q tests/unit/test_conversation_crud.py
# esperado: 4 failed, 1 passed
```

Pasa solo `test_renombrar_no_cambia_la_fecha`, que protege lo que ya funciona. Pega en la entrega el resumen y la línea `E …` de cada fallo. Fíjate en el `db.expire_all()` de los tests: sin él, ¿qué leería `db.get`? (Paso 4, bloque 1).

### Paso 6 — Arreglo 1: `actualizada_en` se mueve con cada mensaje (15 min)

En `backend/app/db/crud/conversation.py`, añade `import datetime` arriba del todo (antes de `from sqlalchemy import select, update`) y sustituye `anadir_mensaje` entera por:

```python
def anadir_mensaje(db: Session, conversacion_id: int, rol: str,
                   contenido: str, fuentes: list | None = None) -> Mensaje:
    # Un solo instante para las dos filas: el mensaje y la conversacion quedan
    # con la misma fecha, y la lista de la UI ordena por la de la conversacion.
    ahora = datetime.datetime.now()
    mensaje = Mensaje(
        conversacion_id=conversacion_id,
        rol=rol,
        contenido=contenido,
        fuentes=fuentes,
        creado_en=ahora,
    )
    db.add(mensaje)
    # Insertar en `mensajes` no toca la fila de `conversaciones`, asi que su
    # onupdate nunca salta: hay que actualizarla a mano, en la misma transaccion.
    db.execute(
        update(Conversacion)
        .where(Conversacion.id == conversacion_id)
        .values(actualizada_en=ahora)
    )
    db.commit()
    return mensaje
```

```bash
uv run pytest -q tests/unit/test_conversation_crud.py
# esperado: 2 failed, 3 passed  (quedan los dos de claves foráneas)
```

Dos detalles. El `UPDATE` sale **antes** que el `INSERT` (con `autoflush=False`, el mensaje se escribe en el flush del `commit`), pero los dos van en la misma transacción: o se guardan los dos o ninguno. Y se usa `datetime.datetime.now` sin zona a propósito, para no mezclar fechas con y sin zona en la misma columna. Arreglar la zona horaria es otro cambio, que afecta a todas las columnas.

### Paso 7 — Arreglo 2: claves foráneas encendidas en cada conexión (25 min)

En `backend/app/db/session.py`, añade `import sqlite3` arriba del todo, cambia la primera línea de SQLAlchemy por estas dos:

```python
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
```

Y justo después de `settings = get_settings()` (antes de `engine = create_engine(...)`), añade:

```python
@event.listens_for(Engine, "connect")
def _activar_claves_foraneas(conexion_dbapi, _registro) -> None:
    """SQLite trae las claves foraneas APAGADAS, y el ajuste es por conexion.

    Sin esto, `ondelete="CASCADE"` es decorativo y se puede guardar un mensaje
    de una conversacion que no existe. Se escucha en la clase `Engine`, no en
    `engine`, para que valga tambien para los motores de los tests.
    """
    if isinstance(conexion_dbapi, sqlite3.Connection):
        cursor = conexion_dbapi.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
```

Es la receta de la documentación de SQLAlchemy: el evento `connect` salta cada vez que el pool abre una conexión **nueva**, y escuchar en la clase `Engine` lo aplica a todos los motores, incluido el `sqlite://` de los tests. El `isinstance` evita lanzar el `PRAGMA` si un día la URL es de Postgres.

```bash
uv run pytest -q tests/unit/test_conversation_crud.py   # ¿5 passed?
```

Ahora el experimento que justifica el último cambio. Crea un test temporal que **se ejecute el primero**:

```bash
cat > tests/unit/test_aaa_sonda.py <<'EOF'
import sys
from sqlalchemy import text

def test_sonda(engine):
    print("\n¿session importada?", "app.db.session" in sys.modules)
    with engine.connect() as c:
        print("foreign_keys =", c.execute(text("PRAGMA foreign_keys")).scalar())
EOF
uv run pytest -q -s tests/unit/test_aaa_sonda.py
uv run pytest -q -s tests/unit/test_conversation_crud.py tests/unit/test_aaa_sonda.py
```

Verás `foreign_keys = 0` en la primera ejecución y `1` en la segunda. El listener se registra al **importar** `app.db.session`, y en una sesión de pytest eso no ocurre hasta que el fixture *autouse* `nunca_la_base_de_datos_real` importa `app.rag.streaming`. Para entonces el fixture `engine` ya ha abierto su única conexión (`StaticPool`), sin el `PRAGMA`. Es decir: **el primer test de cada ejecución corre con las claves apagadas**, y que tu test de FK pase o falle depende del orden. Arréglalo haciendo explícita la importación en `backend/tests/conftest.py`, justo debajo de `from app.db.models.document import Base`:

```python
# Importar la sesion registra el PRAGMA foreign_keys=ON en todos los motores.
import app.db.session  # noqa: F401
```

```bash
uv run pytest -q -s tests/unit/test_aaa_sonda.py   # ahora: foreign_keys = 1
rm tests/unit/test_aaa_sonda.py                     # la sonda no se sube
```

### Paso 8 — Compruébalo donde importa (15 min)

En la BD de demostración, con el código arreglado:

```bash
export APP_DB_URL=sqlite:////tmp/agent4u-bd/demo.db
rm -f /tmp/agent4u-bd/demo.db*
PYTHONPATH=. uv run python /tmp/agent4u-bd/sembrar.py
PYTHONPATH=/tmp/agent4u-bd:. uv run uvicorn servidor:app --port 8001     # terminal 1
curl -s localhost:8001/conversaciones | python3 -m json.tool               # terminal 2: ¿CAP primero?
```

Y en tu BD real, si la tienes (en `backend/agent4u.db` si arrancas sin Docker). **Solo lectura**, y sin el `export`:

```bash
unset APP_DB_URL
sqlite3 -header -column agent4u.db "PRAGMA foreign_key_check;"
sqlite3 -header -column agent4u.db "SELECT COUNT(*) AS conversaciones_con_fecha_congelada FROM conversaciones WHERE abs(julianday(actualizada_en) - julianday(creada_en)) < 0.00001;"
sqlite3 -header -column agent4u.db "PRAGMA table_info(documents);"   # ¿tiene job_id?
```

Si usas Docker, la BD está en el volumen: `docker compose exec api python -m sqlite3 /data/agent4u.db` (o copia el fichero con `docker compose cp api:/data/agent4u.db /tmp/`). Pega las tres salidas. Las filas que liste `foreign_key_check` son huérfanas que ya tienes: el arreglo impide crear más, pero no borra las que hay.

### Paso 9 — Validar y subir (5 min)

```bash
cd ~/ruta/AGENT4U/backend
uv run pytest -q                  # 96 passed (91 + 5)
uv run ruff check app tests       # All checks passed!
cd ..
git add backend/app/db/crud/conversation.py backend/app/db/session.py \
        backend/tests/conftest.py backend/tests/unit/test_conversation_crud.py
git diff --cached --stat          # 4 ficheros
git commit -m "fix(db): actualizada_en se mueve con cada mensaje; claves foráneas activas en SQLite"
git push -u origin ejercicio/dia-10
```

**Bonus (opcional, +30 min):** reproduce el 🟠 de migraciones. Copia tu `agent4u.db` a `/tmp`, borra la columna con `DROP INDEX ix_documents_job_id; ALTER TABLE documents DROP COLUMN job_id;` (SQLite no deja borrar una columna indexada), apunta `APP_DB_URL` a la copia y llama a `GET /documentos` con el servidor de demo. Después escribe a mano el `ALTER TABLE … ADD COLUMN` que habría hecho una migración de Alembic y comprueba que se arregla. No hace falta instalar Alembic: se trata de ver qué problema resuelve.

### Preguntas (responde con tus palabras en la entrega)

1. ¿Por qué el `onupdate` de `actualizada_en` no salta al añadir un mensaje? Explícalo en términos de "qué fila recibe un `UPDATE`". ¿Qué otras dos formas de arreglarlo se te ocurren (piensa en un trigger de SQLite y en calcular `MAX(mensajes.creado_en)` al listar)? ¿Qué gana y qué pierde cada una frente a la de hoy?
2. `ondelete="CASCADE"` y `cascade="all, delete-orphan"`: ¿quién ejecuta cada una? ¿Por qué el borrado desde la UI funcionaba aunque las claves foráneas estuvieran apagadas, y qué camino lo rompía?
3. Con tu arreglo de claves foráneas, imagina que borras una conversación desde otra pestaña **mientras** se genera una respuesta en ella. ¿Qué pasa en `streaming.py:67-71` y qué recibe el navegador? ¿Antes del arreglo qué pasaba? ¿Cuál de los dos comportamientos prefieres y qué cambiarías? (Conecta con el 🔴 del día 09.)
4. En el Paso 3, ¿quién lanza el segundo `SELECT` de `GET /conversaciones/{id}` y en qué momento exacto? ¿Qué pasaría si `listar_conversaciones` devolviera también los mensajes de las 20 conversaciones? Ponle nombre al problema y di cómo lo evitarías (`selectinload`).
5. Explica con la salida del Paso 4 qué es el identity map. ¿Por qué el test `documentos_frescos` necesitaba una sesión nueva? ¿Por qué tus tests del Paso 5 usan `db.expire_all()`?
6. ¿Por qué `expire_on_commit=False` es imprescindible en AGENT4U? Señala la línea concreta que fallaría con `True` y en qué momento.
7. Explica el resultado de la sonda del Paso 7. ¿Qué tiene en común con la línea `from app.db.models import conversation as _conversation_models` de `session.py:7`? ¿Cómo reorganizarías `db/` para que no dependa de efectos secundarios al importar?
8. Las fechas: ¿qué hora mostraría la UI en Docker para una conversación creada a las 10:00 de Madrid en noviembre? ¿Y en julio? ¿Qué tres cambios harían falta para arreglarlo bien, y por qué no basta con poner `TZ=Europe/Madrid` en el contenedor?
9. `create_all` frente a Alembic: ¿qué pasó (o habría pasado) con tu `agent4u.db` cuando llegó `job_id`? ¿En qué momento del proyecto dejarías `create_all` y por qué no antes?
10. SQLite frente a Postgres para AGENT4U: di dos situaciones concretas en las que SQLite deja de servir (pista: el worker y el volumen compartido) y qué cambiaría en `session.py` el día que migres.

### Criterios de aceptación

- [ ] Rama `ejercicio/dia-10` en el remoto, creada desde `main` (`git merge-base --is-ancestor origin/main origin/ejercicio/dia-10`).
- [ ] Paso 2: salidas de `.schema mensajes`, `.indexes`, los dos `PRAGMA`, las dos consultas de orden (la de la API y la real), la del JSON con `length(fuentes)`, el `IS NULL` y el experimento de `foreign_key_check` con el `FOREIGN KEY constraint failed`.
- [ ] Paso 3: el log SQL de las cinco llamadas, con los dos `SELECT` del detalle y el `UPDATE` del `PATCH` señalados, y la tabla UI ↔ GraphQL ↔ columna ↔ escritor **completa** (8 filas).
- [ ] Paso 4: salida del laboratorio, relacionada con `documentos_frescos` y con `query_service.py`.
- [ ] Paso 5: `4 failed, 1 passed` **antes** de tocar el código, con la línea de error de cada fallo.
- [ ] Paso 6: `2 failed, 3 passed` tras el primer arreglo.
- [ ] Paso 7: la sonda con `foreign_keys = 0` y `1` según el orden, y `1` tras el cambio del `conftest.py`.
- [ ] Paso 8: `/conversaciones` con *CAP* primero en la BD de demo y las tres consultas sobre tu BD real (o una línea diciendo que no tienes ninguna).
- [ ] `uv run pytest -q` → `96 passed` y `uv run ruff check app tests` limpio (pega los resúmenes).
- [ ] `git diff --stat origin/main origin/ejercicio/dia-10` muestra solo los 4 ficheros del Paso 9 (la sonda no).
- [ ] Las 10 preguntas respondidas con tus palabras.
- [ ] Párrafo para `ARCHITECTURE.md` al final de la entrega.

Entrega (antes de las 8:30 del **lunes 9-nov**):

```bash
git switch aprendizaje && git pull
cp docs/aprendizaje/entregas/PLANTILLA.md docs/aprendizaje/entregas/dia-10.md
# ...rellena dia-10.md: salidas de sqlite3, log SQL, tabla UI, laboratorio, pytest y ruff, respuestas y párrafo...
git add docs/aprendizaje/entregas/dia-10.md
git commit -m "entrega día 10" && git push
```

Si quieres feedback antes de entregar, pega `docs/aprendizaje/PROMPT_REVISION.md` en Claude Code con `XX = 10`, estando en tu rama `ejercicio/dia-10`.

---

## 5. Para profundizar (opcional)

- SQLAlchemy 2.0, *Session Basics* (identity map, expiración, flush y el ciclo de vida de la sesión): https://docs.sqlalchemy.org/en/20/orm/session_basics.html
- SQLAlchemy 2.0, dialecto SQLite, *Foreign Key Support* (la receta del evento `connect` que has usado hoy) y *Serializable isolation / Savepoints / Transactional DDL*: https://docs.sqlalchemy.org/en/20/dialects/sqlite.html#foreign-key-support

---

## 6. Aportación a `ARCHITECTURE.md`

Tu párrafo para la sección *8. Persistencia* debería cubrir:

- El fichero: una `agent4u.db` compartida por `api` y `worker` en el volumen `api_data`, en WAL y con `timeout=30`, y por qué hacen falta esas dos cosas desde que existe el worker.
- Las tres tablas, sus relaciones y qué guarda cada una, incluida la foto de fuentes en JSON y el id aleatorio de 5 cifras con sus límites.
- El patrón de sesiones: una por petición con `get_db`, propias con `SessionLocal()` para lo que sobrevive a la petición, el "pasa el entero, no el objeto" y por qué `expire_on_commit=False`.
- Que el CRUD hace `commit` en cada función y qué consecuencia tiene para la atomicidad (la fila `en-cola` sin trabajo en Redis).
- Los dos arreglos de hoy: `actualizada_en` y las claves foráneas por conexión, con el detalle del orden de importación en los tests.
- Los huecos abiertos: sin migraciones, fechas sin zona, borrado por nombre, `'null'` en JSON y SQL síncrono en corrutinas.

**El lunes 9-nov (día 11):** el gateway GraphQL con Strawberry. Por qué hay un BFF entre el frontend y la API, cómo se traduce cada query a una llamada REST con `BackendClient`, por qué `/preguntar` y la subida de ficheros **no** pasan por GraphQL sino por un *passthrough*, y qué se pierde por el camino (verás que `actualizada_en` llega al frontend como `str`, sin tipo de fecha). El ejercicio pide exponer tu `/stats` del día 04 como query GraphQL. No lo tienes, así que el lunes partiremos de un endpoint mínimo que crearás en el primer paso.
