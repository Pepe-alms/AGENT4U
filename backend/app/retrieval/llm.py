
import litellm

import os
import sys
from dotenv import load_dotenv

load_dotenv()

gemini_api_key = os.getenv("GEMINI_API_KEY")

# for name, data in litellm.model_cost.items():
#     if data.get("litellm_provider") == "gemini":
#         print(name, data.get("input_cost_per_token"), data.get("output_cost_per_token"))



response = litellm.completion(
    model = "gemini/gemini-flash-lite-latest",
    messages = [{"role": "user", "content": "¿Qué es el big data?"}])

print(response.choices[0].message.content)