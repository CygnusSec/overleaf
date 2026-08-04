# Backup and restore

The Backup Manager creates disaster-recovery bundles containing:

- a logical MongoDB dump;
- a Redis RDB snapshot;
- all persistent ShareLaTeX project and history data;
- the deployment source and configuration, including `.env`, Compose files,
  the custom server Dockerfile, and local application customizations;
- a manifest and SHA-256 checksums.
- OpenPGP symmetric encryption using AES-256.

Backups are stored under `BACKUP_DATA_PATH`. Protect this directory: the
deployment configuration contains secrets.

Set `BACKUP_ENCRYPTION_PASSPHRASE` to a strong, separately stored secret before
enabling backups. Losing this passphrase makes all backup archives
unrecoverable.

## Create and schedule backups

Open **Admin → Backup & Restore**. From there an administrator can:

- queue a backup immediately;
- configure daily or weekly backups;
- configure the local retention count;
- download, import, and delete archives.

The scheduler uses the timezone configured by `TZ`.

## Production rollout

Before enabling a schedule:

1. Set a unique `BACKUP_ENCRYPTION_PASSPHRASE` and store it outside the
   Overleaf server.
2. Verify that `BACKUP_DATA_PATH` is on storage with enough free space.
3. Confirm `BACKUP_WEB_UID/GID` match the ShareLaTeX web user and
   `BACKUP_REDIS_UID/GID` match the Redis image.
4. Create one manual backup during a low-traffic window.
5. Restore that archive on an isolated server and verify users, projects,
   history, compilation, and integrations.
6. Only then enable the daily or weekly schedule.

During a backup, the application enters maintenance mode, disconnects active
editors, waits for `BACKUP_QUIESCE_SECONDS`, and then snapshots data. The
backup container is limited by `BACKUP_CPU_LIMIT` and `BACKUP_MEMORY_LIMIT`.
The normal scheduler container has read-only access to application data and
deployment source. Writable production mounts are only attached to the
explicit `restore` Compose profile.

## Restore onto a new server

Install Docker and copy this deployment directory to the new server. Run the
initialization wizard:

```sh
./server-ce/bin/init-server
```

It provides exactly two choices:

1. **Create a new server** — validates `.env`, creates all persistent
   directories, builds required local images, and starts the stack.
2. **Import an existing backup** — copies the selected archive into
   `BACKUP_DATA_PATH`, stops data-writing services, starts MongoDB, verifies and
   restores the backup, then starts the complete stack.

The same operations can be run non-interactively:

```sh
./server-ce/bin/init-server new
./server-ce/bin/init-server restore /path/to/overleaf-backup.tar.gz.gpg
```

When `.env` does not exist, the wizard creates it from `.env.example` and asks
the operator to configure it before continuing.

The manual restore sequence used by the wizard is:

```sh
docker compose stop sharelatex redis backup-manager cloudflared
docker compose up -d mongo
docker compose pull backup-manager
docker compose --profile restore run --rm --no-deps backup-restore \
  restore /backups/overleaf-backup-YYYYMMDDTHHMMSSZ.tar.gz.gpg \
  --confirm-data-loss
docker compose up -d
```

The restore command verifies the outer checksum when available, validates all
checksums inside the bundle, checks the backup format, restores MongoDB with
`--drop`, installs the Redis RDB, restores persistent ShareLaTeX data, and
restores deployment configuration.

Restore is intentionally offline and destructive. Never run it while users
are editing or while the ShareLaTeX and Redis services are active.

## Off-site copies

The built-in retention policy only manages local archives. Copy
`BACKUP_DATA_PATH` to encrypted off-site or object storage and periodically
test restoration on an isolated server.
