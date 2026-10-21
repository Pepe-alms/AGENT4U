# Entrega día XX — <tema>

- **Rama de código:** ejercicio/dia-1
- **Tiempo dedicado:** 40 min
- **¿Terminado?:** sí

## Respuestas a las preguntas del ejercicio

1. Dibuja (en ASCII o Mermaid) los 6 servicios y quién habla con quién, **sin mirar la píldora**. Después compáralo y corrige.

frontend ──────────▶│ gateway  :8080  (Strawberry + FastAPI)             │
                    │   └─ passthrough: SSE /preguntar, multipart fichero│
                    └──────────────────────┬─────────────────────────────┘
                                             │ HTTP
                                             ▼
                      ┌──────────── api :8000 (FastAPI) ───────────────────┐
                      │  /preguntar → grafo LangGraph → Qdrant + Gemini     │
                      │  /indexar*  → ENCOLA en Redis y responde 202        │
                      └───────┬───────────────┬──────────────┬─────────────┘
                              │               │              
                        Qdrant :6333     Redis :6379      
                         (vectores)     (cola ARQ)        
                              ▲               │              
                              │               ▼             
                              └──────── worker (ARQ) 
                                 Docling + fastembed: indexa en segundo plano



2. ¿Por qué `api` y `worker` usan la misma imagen? ¿Qué ganas y qué riesgo introduce?


Ganas que cuando se ejecute el backend, se despliegue toda la parte de indexacio a la par que la de consulta, agilizando el lanzamiento


3. Enumera los objetos que el `lifespan` mete en `app.state` y di para qué sirve cada uno, en una frase tuya. Marca los que sobran y pega la evidencia del Paso 4.

    app.state.dense_embedder = TextEmbedding(model_name="intfloat/multilingual-e5-large")
    app.state.sparse_embedder = SparseTextEmbedding(model_name= "Qdrant/bm25", language= "spanish")
    app.state.cross_encoder = TextCrossEncoder(model_name = "jinaai/jina-reranker-v2-base-multilingual")
    app.state.qdrant = QdrantClient(url=settings.qdrant_url)
    app.state.converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opciones_pdf),
        }
    )
    app.state.chunker = HybridChunker(tokenizer=tokenizer)
    app.state.cola = ColaArq(settings.redis_url)
    app.state.grafo = crear_grafo(
        dense_embedder=app.state.dense_embedder,
        sparse_embedder=app.state.sparse_embedder,
        qdrant=app.state.qdrant,
        cross_encoder=app.state.cross_encoder,
        model=settings.llm_model,
    )

    Diria que sobran: app.state.dense_embedder app.state.sparse_embedder app.state.qdrant 


4. Pega la salida de `/health/qdrant` con Qdrant caído. ¿Por qué 200? ¿Te parece buena decisión? Argumenta.

{
  "status": "unhealthy",
  "services": {
    "qdrant": {
      "status": "down",
      "error": "Connection refused (os error 111)"
    }
  }
}

Devolver un HTTP 200 a pesar de que el JSON interno declare explícitamente "status": "unhealthy" es un patrón de diseño intencionado en el desarrollo de APIs. La razón técnica es que el servidor de la API que aloja el endpoint de salud está funcionando correctamente. Desde la perspectiva de la red, la petición HTTP se procesó

5. ¿Por qué dentro de Docker la URL de Qdrant es `http://qdrant:6333` y en tu Mac `http://localhost:6333`? ¿De dónde sale cada valor (`docker-compose.yml` frente a `config.py`)?

qdrant = QdrantClient("http://localhost:6333") # Connect to existing Qdrant instance, porque lo llamas desde el cliente

6. ¿Qué hace `depends_on: condition: service_healthy` y qué cadena de arranque provoca entre `redis`, `api` y `gateway`?

El parámetro depends_on: condition: service_healthy en Docker Compose sirve para definir dependencias de arranque estrictas, asegurando que un contenedor no solo comience a ejecutarse, sino que esté completamente operativo y listo para recibir tráfico antes de iniciar los servicios que dependen de él.
A diferencia del depends_on básico (que solo espera a que el contenedor anterior esté en estado running), la opción service_healthy monitorea el healthcheck (prueba de salud) configurado en el servicio de origen.


1. Primer eslabón: redis

Docker Compose inicia el contenedor de redis. El resto de los servicios (api y gateway) se quedan en estado de espera (paused o waiting). redis debe ejecutar internamente su healthcheck (por ejemplo, un comando como redis-cli ping). Hasta que este comando no devuelva un estado exitoso (healthy), la cadena no avanza.

2. Segundo eslabón: api

Una vez que redis está reportando salud positiva, Docker Compose libera e inicia el contenedor de la api. La api arranca sabiendo con total certeza que la base de datos ya está aceptando conexiones (evitando errores de conexión tempranos y caídas del proceso). Ahora la api comienza a ejecutar su propio healthcheck (por ejemplo, haciendo una petición HTTP local a /health).

3. Tercer eslabón: gateway

El gateway permanece retenido hasta que la api cambie su estado a healthy. En cuanto la api responde correctamente a sus pruebas de salud, Docker Compose inicia finalmente el gateway. El ecosistema queda completamente operativo de abajo hacia arriba, garantizando que el usuario final nunca reciba un error de redirección o un Bad Gateway (502) durante el despliegue.

7. Compara **BGE-M3** (un modelo para denso y disperso) con lo que hay, **e5 + BM25 + reranker**. ¿Qué gana y qué pierde cada opción? 


Lo que GANA:

• Simplicidad arquitectónica radical: No necesitas mantener un clúster de Elasticsearch/OpenSearch separado solo para BM25. Bases de datos vectoriales modernas (como Qdrant o Milvus) pueden almacenar y buscar los vectores densos y dispersos generados por BGE-M3 simultáneamente.
• Ventana de contexto masiva: Soporta hasta 8192 tokens. Los modelos E5 tradicionales suelen estar limitados a 512 tokens.
• Híbrido real semántico-léxico: Su embedding disperso no busca solo palabras exactas (como BM25); busca la importancia de los términos dentro del contexto semántico.

Lo que PIERDE:

• Carga computacional en la indexación: Generar los tres tipos de vectores al mismo tiempo exige más memoria (RAM/VRAM) y procesamiento de cómputo durante la fase de ingesta de datos.
• Precisión extrema en el Top-K final: Al no tener una etapa dedicada de cross-encoder (Reranker) al final del proceso que analice minuciosamente la relación par query-documento, la precisión pura de los primeros 3 resultados puede ser ligeramente inferior a la de un buen Reranker.





## Evidencias

1. Levantamos 2 servicios

(agent4u-backend) pepealms@MacBook-Air-de-Jose Agent4U % docker compose up -d qdrant redis
WARN[0000] The "APP_GEMINI_API_KEY" variable is not set. Defaulting to a blank string. 
WARN[0000] The "APP_GEMINI_API_KEY" variable is not set. Defaulting to a blank string. 
[+] up 2/2
 ✔ Container QdrantDatabase  Started                                                                                                              0.1s
 ✔ Container agent4u-redis-1 Started                                                                                                              0.1s
(agent4u-backend) pepealms@MacBook-Air-de-Jose Agent4U % docker compose ps 
WARN[0000] The "APP_GEMINI_API_KEY" variable is not set. Defaulting to a blank string. 
WARN[0000] The "APP_GEMINI_API_KEY" variable is not set. Defaulting to a blank string. 
NAME              IMAGE                   COMMAND                  SERVICE   CREATED        STATUS                            PORTS
QdrantDatabase    qdrant/qdrant:v1.19.0   "./entrypoint.sh"        qdrant    2 months ago   Up 6 seconds                      0.0.0.0:6333-6334->6333-6334/tcp, [::]:6333-6334->6333-6334/tcp
agent4u-redis-1   redis:7-alpine          "docker-entrypoint.s…"   redis     10 hours ago   Up 6 seconds (health: starting)   0.0.0.0:6379->6379/tcp,[::]:6379->6379/tcp
(agent4u-backend) pepealms@MacBook-Air-de-Jose Agent4U %

2. Levantamos el worker y las reglas de negocio y se descargan todos los modelos

pepealms@MacBook-Air-de-Jose Agent4U % cd backend
pepealms@MacBook-Air-de-Jose backend % 
pepealms@MacBook-Air-de-Jose backend % uv run uvicorn app.api.main:app --reload
INFO:     Will watch for changes in these directories: ['/Users/pepealms/Documents/Agent4U/backend']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [19943] using WatchFiles


pepealms@MacBook-Air-de-Jose backend % grep -rn "state.converter\|state.chunker" app/
app/api/lifespan.py:50:    app.state.converter = DocumentConverter(
app/api/lifespan.py:59:    app.state.chunker = HybridChunker(tokenizer=tokenizer)
pepealms@MacBook-Air-de-Jose backend % 

Vaya, aparece definido en mas de un sitio...

## Párrafo para ARCHITECTURE.md

He aprendido sobre la composicion de los microservicios, la fantastica funcion lifespan del framework FastAPI que permite hacer ejecuciones iniciales con el inicio de sesio y los modelos que usamos para hacer la extraccion de informacion.

Ademas he conocimo mas a fondo que es nginx y para que se usa middleware dentro del objeto (o no se si llamarlo instancia) app de la clase FastAPI
