# Postgres sized for a 256 MB machine. Same server as the compose stack (16); only the memory settings differ.
FROM postgres:16-alpine
CMD ["postgres", "-c", "shared_buffers=32MB", "-c", "max_connections=30", "-c", "work_mem=2MB", "-c", "maintenance_work_mem=16MB", "-c", "effective_cache_size=96MB"]
