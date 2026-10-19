#!/usr/bin/env bash
# Restore a backup into an EMPTY database (it refuses to touch a non-empty one).
#   restore.sh [latest|<object name>]      env as backup.sh, plus RESTORE_DATABASE (default <PGDATABASE>_restored),
#                                          BACKUP_AGE_IDENTITY (path to the age private key) if the dump is encrypted
set -euo pipefail
: "${BACKUP_S3_BUCKET:?}" "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}"
PREFIX="${BACKUP_PREFIX:-postgres/}"; TARGET="${RESTORE_DATABASE:-${PGDATABASE}_restored}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
WANT="${1:-latest}"
if [ "$WANT" = latest ]; then
  WANT=$(aws s3api list-objects-v2 --bucket "${BACKUP_S3_BUCKET}" --prefix "${PREFIX}" --query 'Contents[].Key' --output text | tr '\t' '\n' \
        | grep -E '\.dump(\.age)?$' | sed "s#^${PREFIX}##" | sort | tail -1)
  [ -n "$WANT" ] || { echo "no backup found" >&2; exit 1; }
fi
echo "restoring ${WANT} into ${TARGET}"
aws s3 cp --only-show-errors "s3://${BACKUP_S3_BUCKET}/${PREFIX}${WANT}" "$WORK/$WANT"
aws s3 cp --only-show-errors "s3://${BACKUP_S3_BUCKET}/${PREFIX}${WANT}.sha256" "$WORK/$WANT.sha256"
( cd "$WORK" && sha256sum -c "$WANT.sha256" ) || { echo "CHECKSUM MISMATCH: the stored backup is corrupt, nothing was restored" >&2; exit 2; }

DUMP="$WORK/$WANT"
if [[ "$WANT" == *.age ]]; then
  : "${BACKUP_AGE_IDENTITY:?the dump is encrypted: set BACKUP_AGE_IDENTITY to the age private key file}"
  age -d -i "$BACKUP_AGE_IDENTITY" -o "$WORK/plain.dump" "$WORK/$WANT"; DUMP="$WORK/plain.dump"
fi
psql -d postgres -qtAc "SELECT 1 FROM pg_database WHERE datname='${TARGET}'" | grep -q 1 || createdb "${TARGET}"
N=$(psql -d "${TARGET}" -qtAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[ "$N" = 0 ] || { echo "refusing: ${TARGET} already has ${N} tables" >&2; exit 3; }
pg_restore --no-owner --exit-on-error -d "${TARGET}" "$DUMP"
echo "restored; tables:"; psql -d "${TARGET}" -qtAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
