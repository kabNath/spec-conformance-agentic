# Daily Postgres backup to S3-compatible storage (Tigris on Fly) and restore, plus the tools the restore test needs.
FROM alpine:3.20
RUN apk add --no-cache bash coreutils postgresql16-client aws-cli age ca-certificates
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh && adduser -D -u 10001 backup
USER backup
ENTRYPOINT ["/usr/local/bin/backup.sh"]
