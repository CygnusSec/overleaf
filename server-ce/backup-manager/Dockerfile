FROM mongo:8.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      gnupg \
      jq \
      redis-tools \
      tzdata \
      util-linux \
    && rm -rf /var/lib/apt/lists/*

COPY server-ce/backup-manager/bin/overleaf-backup /usr/local/bin/overleaf-backup
COPY server-ce/backup-manager/bin/backup-scheduler /usr/local/bin/backup-scheduler
RUN chmod 755 /usr/local/bin/overleaf-backup /usr/local/bin/backup-scheduler

ENTRYPOINT ["/usr/local/bin/overleaf-backup"]
CMD ["scheduler"]
