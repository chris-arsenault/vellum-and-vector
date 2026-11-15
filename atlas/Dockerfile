FROM ubuntu:26.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 curl && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 dist/atlas_server /usr/local/bin/atlas_server
COPY frontend/dist/ /opt/atlas/frontend/
RUN chmod -R a+rX /opt/atlas/frontend
RUN mkdir -p /data /scratch && chown 1000:1000 /data /scratch
USER 1000:1000
CMD ["atlas_server"]
