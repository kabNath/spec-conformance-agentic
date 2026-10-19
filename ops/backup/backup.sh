#!/usr/bin/env bash
# pg_dump (custom format) → optional age encryption → S3-compatible bucket, plus a .sha256, then prune old backups.
# Env: PGHOST PGUSER PGPASSWORD PGDATABASE · BACKUP_S3_BUCKET · AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL_S3 (+ AWS_REGION)
#      BACKUP_PREFIX (default postgres/) · BACKUP_AGE_RECIPIENT (age public key; strongly recommended: dumps hold customer verdicts)
#      BACKUP_RETENTION_DAYS (default 14). Exit code != 0 on ANY failure: a scheduler/monitor must treat that as "no backup today".
set -euo pipefail
# S3-compatible stores differ on the newer default integrity trailers of aws-cli v2; ask only when the API requires them (we verify with our own SHA-256).
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}" AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"
: "${BACKUP_S3_BUCKET:?}" "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}"
PREFIX="${BACKUP_PREFIX:-postgres/}"; RETENTION="${BACKUP_RETENTION_DAYS:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
EXT="dump"; [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && EXT="dump.age"
NAME="${PGDATABASE}-${TS}.${EXT}"

echo "dumping ${PGDATABASE}@${PGHOST}"
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  pg_dump --format=custom --no-owner "${PGDATABASE}" | age -r "${BACKUP_AGE_RECIPIENT}" > "$WORK/$NAME"
else
  echo "warning: BACKUP_AGE_RECIPIENT not set, the dump is stored unencrypted (bucket-side encryption only)" >&2
  pg_dump --format=custom --no-owner "${PGDATABASE}" > "$WORK/$NAME"
fi
SIZE=$(stat -c %s "$WORK/$NAME"); [ "$SIZE" -gt 0 ] || { echo "empty dump" >&2; exit 1; }
( cd "$WORK" && sha256sum "$NAME" > "$NAME.sha256" )

aws s3 cp --only-show-errors "$WORK/$NAME" "s3://${BACKUP_S3_BUCKET}/${PREFIX}${NAME}"
aws s3 cp --only-show-errors "$WORK/$NAME.sha256" "s3://${BACKUP_S3_BUCKET}/${PREFIX}${NAME}.sha256"
REMOTE=$(aws s3api head-object --bucket "${BACKUP_S3_BUCKET}" --key "${PREFIX}${NAME}" --query ContentLength --output text)
[ "$REMOTE" = "$SIZE" ] || { echo "uploaded size $REMOTE != local $SIZE" >&2; exit 1; }
echo "uploaded ${PREFIX}${NAME} (${SIZE} bytes)"

# prune: keys carry their UTC timestamp, no reliance on object metadata
CUTOFF="$(date -u -d "-${RETENTION} days" +%Y%m%dT%H%M%SZ)"
aws s3api list-objects-v2 --bucket "${BACKUP_S3_BUCKET}" --prefix "${PREFIX}" --query 'Contents[].Key' --output text | tr '\t' '\n' | while read -r key; do
  [ -n "$key" ] && [ "$key" != "None" ] || continue
  stamp=$(echo "$key" | sed -n 's/.*-\([0-9]\{8\}T[0-9]\{6\}Z\)\.dump.*/\1/p')
  if [ -n "$stamp" ] && [[ "$stamp" < "$CUTOFF" ]]; then aws s3 rm --only-show-errors "s3://${BACKUP_S3_BUCKET}/${key}"; echo "pruned $key"; fi
done
echo "ok"
