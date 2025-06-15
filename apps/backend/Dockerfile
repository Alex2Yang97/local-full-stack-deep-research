# use uv to build the backend
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# set workdir
WORKDIR /app

# enable bytecode compilation to improve startup speed
ENV UV_COMPILE_BYTECODE=1

# copy dependency files
COPY uv.lock pyproject.toml ./

# install project dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project

# copy project code
COPY . .

# install project itself
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

# add virtual environment to PATH
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"

# expose port
EXPOSE 8000

# use uv to run application
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]