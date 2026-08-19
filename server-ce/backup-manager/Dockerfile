FROM mongo:8.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      gnupg \
      jq \
      python3 \
      python3-venv \
      redis-tools \
      tzdata \
      util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/backup-s3 \
    && /opt/backup-s3/bin/pip install --no-cache-dir boto3==1.35.99

COPY server-ce/backup-manager/bin/overleaf-backup /usr/local/bin/overleaf-backup
COPY server-ce/backup-manager/bin/backup-scheduler /usr/local/bin/backup-scheduler
COPY server-ce/backup-manager/bin/backup-s3-upload /usr/local/bin/backup-s3-upload
RUN chmod 755 \
      /usr/local/bin/overleaf-backup \
      /usr/local/bin/backup-scheduler \
      /usr/local/bin/backup-s3-upload

ENTRYPOINT ["/usr/local/bin/overleaf-backup"]
CMD ["scheduler"]
