FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 curl && rm -rf /var/lib/apt/lists/*
COPY dist/atlas_server /usr/local/bin/atlas_server
COPY frontend/dist/ /opt/atlas/frontend/
RUN chmod -R a+rX /opt/atlas/frontend
USER 1000:1000
CMD ["atlas_server"]
