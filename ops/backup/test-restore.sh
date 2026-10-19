#!/usr/bin/env bash
# Backup → restore round trip against a throw-away Postgres and an S3-compatible store (an S3 API fake).
#   ops/backup/test-restore.sh        (needs Docker; pulls postgres:16-alpine and adobe/s3mock)
# Proves: a restored database has the same rows and indexes (incl. the partial unique index) as the source; an encrypted
# dump cannot be restored without the key; a corrupted object is refused; old backups are pruned; a non-empty target is refused.
set -euo pipefail
cd "$(dirname "$0")"
# Plain `docker run` (no compose): a throw-away network with a source Postgres, an S3 API fake and the backup image.
ID="sca-backup-test-$$"
cleanup() { docker rm -f "$ID-db" "$ID-s3" "$ID-tools" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
T() { docker exec -i "$ID-tools" "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

docker network create "$ID" >/dev/null
docker build -q -t sca-backup-tools . >/dev/null
docker run -d --name "$ID-db" --network "$ID" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=conformance postgres:16-alpine >/dev/null
docker run -d --name "$ID-s3" --network "$ID" adobe/s3mock >/dev/null   # an S3 API fake (MinIO no longer publishes a free image)
docker run -d --name "$ID-tools" --network "$ID" --user root --workdir /work --entrypoint sleep \
  -e PGHOST="$ID-db" -e PGUSER=postgres -e PGPASSWORD=pw -e PGDATABASE=conformance \
  -e BACKUP_S3_BUCKET=test-backups -e AWS_ACCESS_KEY_ID=testkey -e AWS_SECRET_ACCESS_KEY=testsecret123 \
  -e AWS_ENDPOINT_URL_S3="http://$ID-s3:9090" -e AWS_REGION=us-east-1 -e AWS_EC2_METADATA_DISABLED=true \
  sca-backup-tools infinity >/dev/null
for i in $(seq 1 60); do docker exec "$ID-db" pg_isready -U postgres -d conformance >/dev/null 2>&1 && break; sleep 1; done
docker exec "$ID-db" pg_isready -U postgres -d conformance >/dev/null || fail "source Postgres did not come up"

echo "== schema = the real migrations, in order; data = representative rows"
T mkdir -p /work
docker cp ../../prisma/migrations "$ID-tools:/work/"
docker cp test-seed.sql "$ID-tools:/work/seed.sql"
docker cp test-compare.sql "$ID-tools:/work/compare.sql"
T bash -c 'for f in $(ls /work/migrations/*/migration.sql | sort); do psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || exit 1; done'
# Prisma's own bookkeeping table, so the restored database is also accepted by `prisma migrate deploy` (no re-apply)
T psql -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count int NOT NULL DEFAULT 0);
INSERT INTO "_prisma_migrations"(id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('m1','x',now(),'init',1),('m2','y',now(),'mcp_api_keys',1);
SQL
T psql -q -v ON_ERROR_STOP=1 -f /work/seed.sql
for i in $(seq 1 60); do T aws s3 mb s3://test-backups >/dev/null 2>&1 && break; T aws s3 ls s3://test-backups >/dev/null 2>&1 && break; sleep 2; done
T aws s3 ls s3://test-backups >/dev/null || fail "the S3 fake did not come up"
T bash -c 'age-keygen -o /tmp/age.key 2>/tmp/age.pub; grep -o "age1[a-z0-9]*" /tmp/age.pub > /tmp/recipient'

echo "== backup (encrypted)"
T bash -c 'BACKUP_AGE_RECIPIENT=$(cat /tmp/recipient) backup.sh'
T aws s3 ls s3://test-backups/postgres/ | sed 's/^/   /'

echo "== restore into a new database and compare with the source"
T bash -c 'BACKUP_AGE_IDENTITY=/tmp/age.key RESTORE_DATABASE=restored restore.sh latest' | tail -2
SRC=$(T psql -qtA -d conformance -f /work/compare.sql); DST=$(T psql -qtA -d restored -f /work/compare.sql)
echo "$SRC" | sed 's/^/   /'
[ "$SRC" = "$DST" ] || { echo "$DST"; fail "restored data differs from the source"; }
echo "ok: row counts and content hashes identical (incl. UTF-8 and JSON columns)"
T psql -qtA -d restored -c "INSERT INTO \"ApiKey\"(id,\"orgId\",name,prefix,\"keyHash\") VALUES ('k9','org_a','dup','sca_dddddddd','h9')" 2>&1 | grep -q "ApiKey_one_active_per_org" \
  || fail "the partial unique index (one active key per organisation) is missing after restore"
echo "ok: the one-active-key-per-organisation constraint is enforced after restore"

echo "== negative: without the age key the encrypted dump is not restorable"
if T bash -c 'RESTORE_DATABASE=nokey restore.sh latest' >/dev/null 2>&1; then fail "restore succeeded without BACKUP_AGE_IDENTITY"; fi
echo "ok: refused"
echo "== negative: restoring into a non-empty database is refused"
if T bash -c 'BACKUP_AGE_IDENTITY=/tmp/age.key RESTORE_DATABASE=restored restore.sh latest' >/dev/null 2>&1; then fail "restored over a non-empty database"; fi
echo "ok: refused"
echo "== negative: a corrupted object is detected"
KEY=$(T aws s3 ls s3://test-backups/postgres/ | awk '{print $4}' | grep -E '\.dump\.age$' | tail -1)
T bash -c "aws s3 cp --only-show-errors s3://test-backups/postgres/$KEY /tmp/x && printf 'X' | dd of=/tmp/x bs=1 seek=40 conv=notrunc 2>/dev/null && aws s3 cp --only-show-errors /tmp/x s3://test-backups/postgres/$KEY"
if T bash -c 'BACKUP_AGE_IDENTITY=/tmp/age.key RESTORE_DATABASE=corrupt restore.sh latest' 2>&1 | grep -q "CHECKSUM MISMATCH"; then echo "ok: checksum mismatch reported, nothing restored"; else fail "a corrupted backup was not detected"; fi

echo "== retention: a backup older than the window is pruned, a recent one kept"
T bash -c 'echo old > /tmp/o && aws s3 cp --only-show-errors /tmp/o s3://test-backups/postgres/conformance-20200101T000000Z.dump'
T bash -c 'BACKUP_RETENTION_DAYS=14 BACKUP_AGE_RECIPIENT=$(cat /tmp/recipient) backup.sh' | grep -q "pruned postgres/conformance-20200101T000000Z.dump" || fail "old backup not pruned"
T aws s3 ls s3://test-backups/postgres/ | grep -q "20200101" && fail "old backup still there"
echo "ok: pruned"
echo "PASS"
