# Multi-stage Dockerfile for terminar-server
#
# Build:
#   docker build -t terminar-server -f Dockerfile .
#
# Run:
#   docker run -p 3000:3000 terminar-server
#
# Run with options:
#   docker run -p 8080:8080 terminar-server --port 8080 --log-json --persist-sessions

# Stage 1: Build the Rust binary
FROM rust:1.77-bookworm AS builder

WORKDIR /build

# Copy only the server crate (no workspace needed)
COPY server/Cargo.toml server/Cargo.lock* ./
# Create a dummy main.rs to cache dependency compilation
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true

# Now copy the real source and build
COPY server/src ./src
# Touch main.rs to force rebuild of our code (not dependencies)
RUN touch src/main.rs
RUN cargo build --release

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    zsh \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for running the server
RUN useradd --create-home --shell /bin/bash pshell

# Copy the compiled binary
COPY --from=builder /build/target/release/terminar-server /usr/local/bin/terminar-server

# Ensure the binary is executable
RUN chmod +x /usr/local/bin/terminar-server

# Create directories for persistence
RUN mkdir -p /data/sessions /data/history && chown -R pshell:pshell /data

USER pshell
WORKDIR /home/pshell

# Default HTTP port
EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run the server with sensible defaults for containerized use
ENTRYPOINT ["terminar-server"]
CMD [ \
    "--port", "3000", \
    "--no-auth", \
    "--persist-sessions", \
    "--session-file", "/data/sessions/sessions.json", \
    "--persist-history", \
    "--history-dir", "/data/history" \
]
