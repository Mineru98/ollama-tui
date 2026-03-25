FROM vllm/vllm-openai:latest

# GLM-4.7-Flash requires transformers from source (glm4_moe_lite architecture)
# Update huggingface_hub first, then force-reinstall transformers without pulling all deps
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    pip install --no-cache-dir -U huggingface_hub && \
    pip install --no-cache-dir --force-reinstall --no-deps git+https://github.com/huggingface/transformers.git@main && \
    apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
