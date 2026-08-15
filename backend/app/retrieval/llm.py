
import litellm

import os
import sys
from dotenv import load_dotenv

load_dotenv()

gemini_api_key = os.getenv("GEMINI_API_KEY")

# for nombre, datos in litellm.model_cost.items():
#     if datos.get("litellm_provider") == "gemini":
#         print(nombre, datos.get("input_cost_per_token"), datos.get("output_cost_per_token"))



respuesta = litellm.completion( 
    model = "gemini/gemini-flash-lite-latest",
    messages = [{"role": "user", "content": "¿Qué es el big data?"}])

print(respuesta.choices[0].message.content)