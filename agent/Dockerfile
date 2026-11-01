# Image for LiveKit Cloud agent hosting: `lk agent create` / `lk agent deploy` from agent/ (docs/agent.md).
# .dockerignore keeps env files, caches and tests out of the image and out of the build upload.
FROM ghcr.io/astral-sh/uv:0.13.5-python3.12-trixie-slim

# Compiled bytecode in the image: the free plan scales an idle agent to zero, and every cold start
# would otherwise compile livekit-agents and its plugins before the agent can join the room.
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

ARG UID=10001
RUN adduser --disabled-password --gecos "" --home /app --shell /sbin/nologin --uid "${UID}" appuser
WORKDIR /app
RUN chown appuser:appuser /app
USER appuser

# Dependencies before the code, so a code change doesn't reinstall them.
COPY --chown=appuser:appuser pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY --chown=appuser:appuser src ./src
RUN uv sync --locked --no-dev

# Model files go in the image, so a cold start doesn't download them. Today's plugins ship their
# weights inside the wheels and this is a no-op; it guards against a plugin that downloads at first use.
RUN .venv/bin/python -m livekit.agents download-files

# The venv's Python directly: `uv run` would check the lockfile on every start. LiveKit Cloud needs
# a fixed command that runs `start` itself, with no wrapper script.
CMD [".venv/bin/python", "-m", "agent.main", "start"]
