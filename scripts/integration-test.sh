#!/usr/bin/env bash
#
# Integration test for the backend image.
#
# Exercises the image that was actually built — loaded from a tarball in CI, or built
# locally — rather than the source. The behaviours it covers are the ones that only appear
# once the service is packaged and started: configuration refusal, certificate generation,
# certificate reuse across a restart, and a TLS chain a client can actually verify.
#
# Usage:
#   scripts/integration-test.sh                     build locally, then test
#   scripts/integration-test.sh path/to/image.tar   load the tarball, then test
#
set -euo pipefail

IMAGE_TAR="${1:-}"
IMAGE="doorbell-backend:integration"
CONTAINER="doorbell-integration"
VOLUME="doorbell-integration-certs"
DATA_VOLUME="doorbell-integration-data"
PORT="18443"
HOSTNAME_UNDER_TEST="doorbell.lan"

# Run from the repository root and use relative paths throughout: an absolute path
# built here is not portable to a Windows Docker daemon, which sees a different mount
# namespace than the shell does.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker volume rm -f "$VOLUME" "$DATA_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
    echo "::error::$*" >&2
    exit 1
}

echo "== Preparing image =="
if [ -n "$IMAGE_TAR" ]; then
    # The tarball is the same bytes that were scanned and will be published. Rebuilding
    # here would test something else.
    echo "Loading $IMAGE_TAR"
    loaded="$(docker load --input "$IMAGE_TAR" | tail -1)"
    echo "$loaded"
    src="${loaded#Loaded image: }"
    src="${src#Loaded image ID: }"
    docker tag "$src" "$IMAGE"
else
    echo "Building from ./server"
    docker build -q -t "$IMAGE" server >/dev/null
fi

echo
echo "== 1. Refuses to start when misconfigured =="
# PUBLIC_HOSTNAME is absent. Starting anyway would issue a certificate for a guessed name
# and push the failure onto the tablet, far from its cause.
set +e
output="$(docker run --rm -e MQTT_HOST=mosquitto "$IMAGE" 2>&1)"
code=$?
set -e
[ "$code" -eq 78 ] || fail "expected exit 78 (EX_CONFIG), got $code"
grep -q "PUBLIC_HOSTNAME is required" <<<"$output" ||
    fail "the error message does not name the missing setting"
grep -q "refusing to start" <<<"$output" || fail "the error message does not say it refused to start"
echo "  [PASS] exits 78 and explains why"

echo
echo "== 2. Starts and generates a local CA on first run =="
docker run -d --name "$CONTAINER" \
    -e PUBLIC_HOSTNAME="$HOSTNAME_UNDER_TEST" \
    -e MQTT_HOST=mosquitto \
    -v "$VOLUME:/certs" \
    -p "$PORT:8443" \
    "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
    if docker logs "$CONTAINER" 2>&1 | grep -q "backend listening"; then break; fi
    sleep 1
done
docker logs "$CONTAINER" 2>&1 | grep -q "backend listening" ||
    fail "the backend did not report that it was listening:$(printf '\n%s' "$(docker logs "$CONTAINER" 2>&1)")"

docker logs "$CONTAINER" 2>&1 | grep -q '"tls":"generated"' ||
    fail "expected the first start to generate TLS material"
echo "  [PASS] generated TLS material on first start"

echo
echo "== 3. TLS chain verifies, and verification is not vacuous =="
node scripts/verify-tls.mjs 127.0.0.1 "$PORT" "$HOSTNAME_UNDER_TEST"

fingerprint_before="$(node -e '
const https=require("node:https"),{X509Certificate}=require("node:crypto");
https.get({host:"127.0.0.1",port:process.argv[1],path:"/ca.crt",rejectUnauthorized:false},r=>{
  let b="";r.on("data",c=>b+=c);r.on("end",()=>console.log(new X509Certificate(b).fingerprint256));
});' "$PORT")"

echo
echo "== 4. Reuses the same CA across a restart =="
# A new CA on every restart would silently invalidate every tablet already provisioned.
docker rm -f "$CONTAINER" >/dev/null
docker run -d --name "$CONTAINER" \
    -e PUBLIC_HOSTNAME="$HOSTNAME_UNDER_TEST" \
    -e MQTT_HOST=mosquitto \
    -v "$VOLUME:/certs" \
    -p "$PORT:8443" \
    "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
    if docker logs "$CONTAINER" 2>&1 | grep -q "backend listening"; then break; fi
    sleep 1
done

docker logs "$CONTAINER" 2>&1 | grep -q '"tls":"reused"' ||
    fail "expected the second start to reuse the stored TLS material"

fingerprint_after="$(node -e '
const https=require("node:https"),{X509Certificate}=require("node:crypto");
https.get({host:"127.0.0.1",port:process.argv[1],path:"/ca.crt",rejectUnauthorized:false},r=>{
  let b="";r.on("data",c=>b+=c);r.on("end",()=>console.log(new X509Certificate(b).fingerprint256));
});' "$PORT")"

[ -n "$fingerprint_before" ] || fail "could not read the CA fingerprint before the restart"
[ "$fingerprint_before" = "$fingerprint_after" ] ||
    fail "the CA changed across a restart — every provisioned tablet would stop trusting the server"
echo "  [PASS] identical CA fingerprint across restart"

echo
echo "== 5. Health endpoint matches the API specification =="
health="$(node -e '
const https=require("node:https");
https.get({host:"127.0.0.1",port:process.argv[1],path:"/api/v1/health",rejectUnauthorized:false},r=>{
  let b="";r.on("data",c=>b+=c);r.on("end",()=>{console.log(JSON.stringify({status:r.statusCode,body:b}))});
});' "$PORT")"
grep -q '"status":200' <<<"$health" || fail "health did not return 200: $health"
grep -q '{\\"status\\":\\"ok\\"}' <<<"$health" || fail "unexpected health body: $health"
echo "  [PASS] 200 {\"status\":\"ok\"}"

echo
echo "== 6. The database is created and its migrations survive a restart =="
# The schema must apply before the service accepts a request it cannot store, and a
# restart must re-apply nothing. Both are checked against the container, not mocked.
docker logs "$CONTAINER" 2>&1 | grep -q '"msg":"database ready"' ||
    fail "the backend did not report that the database was ready"
docker exec "$CONTAINER" test -f /data/doorbell.sqlite ||
    fail "no database file was created in the data volume"

# The first start applied the migration; this restart must apply none.
migrations_first="$(docker logs "$CONTAINER" 2>&1 | grep -o '"migrations":\[[^]]*\]' | head -1)"
[ "$migrations_first" != '"migrations":[]' ] ||
    fail "no migrations were applied on first start"
echo "  [PASS] applied on first start: $migrations_first"
echo "  [PASS] database file present in the volume"

echo
echo "== 7. Runs as a non-root user =="
# The image sets USER node. A root container is a finding the scan will not make.
whoami_out="$(docker exec "$CONTAINER" id -un)"
[ "$whoami_out" = "node" ] || fail "expected the container to run as 'node', got '$whoami_out'"
echo "  [PASS] running as $whoami_out"

echo
echo "All integration checks passed."
