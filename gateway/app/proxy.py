import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.post("/preguntar")
async def preguntar(request: Request):
    """Reenvia la pregunta al backend y devuelve su stream SSE tal cual.

    No pasa por GraphQL: un stream no cabe en una respuesta JSON unica.
    """
    client: httpx.AsyncClient = request.app.state.proxy_client
    body = await request.body()
    content_type = request.headers.get("content-type", "application/json")

    peticion = client.build_request(
        "POST", "/preguntar", content=body, headers={"content-type": content_type}
    )
    resp = await client.send(peticion, stream=True)

    if resp.status_code != 200:
        await resp.aread()
        detail = resp.json().get("detail", resp.text)
        await resp.aclose()
        raise HTTPException(status_code=resp.status_code, detail=detail)

    async def generador():
        try:
            async for trozo in resp.aiter_bytes():
                yield trozo
        finally:
            await resp.aclose()

    return StreamingResponse(generador(), media_type="text/event-stream")


@router.post("/indexar-fichero")
async def indexar_fichero(request: Request):
    """Reenvia la subida multipart al backend en streaming, sin bufferizar
    el fichero completo en memoria del gateway.
    """
    client: httpx.AsyncClient = request.app.state.proxy_client
    content_type = request.headers.get("content-type", "")

    resp = await client.post(
        "/indexar-fichero",
        content=request.stream(),
        headers={"content-type": content_type},
    )

    headers = {}
    if "retry-after" in resp.headers:
        headers["retry-after"] = resp.headers["retry-after"]

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type"),
        headers=headers,
    )
