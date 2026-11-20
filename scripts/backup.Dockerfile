FROM postgres:16-alpine
ARG APP_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s#https://dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories \
    && apk add --no-cache age jq openssl coreutils tar redis util-linux su-exec
WORKDIR /opt/msghub
COPY scripts/backup-lib.sh scripts/backup-full.sh scripts/verify-full.sh scripts/backup-runner.sh ./scripts/
RUN sed -i 's/\r$//' /opt/msghub/scripts/*.sh && chmod 700 /opt/msghub/scripts/*.sh \
    && mkdir -p /project/data/backups
ENV PROJECT_ROOT=/project BACKUP_KEY_FILE=/run/secrets/msghub_backup_key PGHOST=postgres PGPORT=5432 REDIS_HOST=redis REDIS_PORT=6379 APP_COMMIT=$APP_COMMIT BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.revision=$APP_COMMIT org.opencontainers.image.created=$BUILD_TIME
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD jq -e --argjson now "$(date +%s)" '(.status == "ready" or .status == "running") and (.keyConfigured == true) and (($now - (.lastSeenAt | fromdateiso8601)) < 90)' "$PROJECT_ROOT/data/backups/control/runner-status.json" >/dev/null || exit 1
ENTRYPOINT ["/opt/msghub/scripts/backup-runner.sh"]
