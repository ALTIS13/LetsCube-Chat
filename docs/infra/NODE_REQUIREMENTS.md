# Node Requirements

Target node: 8 CPU cores, 12 GB RAM, 120 GB storage.

## Operating system

- Current Ubuntu LTS or equivalent Linux server.
- Automatic security updates or a documented patch window.
- Docker and Docker Compose plugin.
- Firewall allowing only required inbound ports.
- Time sync enabled.

## Storage planning

120 GB must cover:

- Docker images and layers;
- KUB app container;
- self-hosted Supabase containers;
- Postgres data;
- Storage objects/media;
- logs;
- temporary dumps;
- local backup staging.

Use off-node backups. Do not keep long backup history on the same 120 GB disk.
Set log rotation before production traffic.

## Memory planning

12 GB RAM is workable for KUB plus Supabase if Sentry is postponed. If Sentry
self-host is added on the same node, memory pressure should be expected; a
separate node is preferred for Sentry.

## Network

- Public DNS for `kub.example.com`.
- Optional DNS for `sentry.example.com` later.
- HTTPS certificates through reverse proxy/Coolify/Caddy.
- Websocket support for Supabase Realtime.
- Large upload limits sized for media attachments.

## Backups

Minimum:

- daily Postgres dump or WAL-capable backup;
- storage object backup;
- secrets/config export stored outside git;
- restore drill before cutover.

Backups should be encrypted and stored off-node.
