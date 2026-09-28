#!/bin/sh
set -eu

PREFIX="${IPV6_PREFIX:-2a03:4000:47:a0c::/64}"
PREFIX="${PREFIX%/64}"
COUNT="${POOL_SIZE:-10000}"
DEVICE="${IPV6_DEVICE:-eth0}"
START="${IPV6_START:-4096}"

case "$COUNT" in
  ''|*[!0-9]*) echo "POOL_SIZE must be numeric" >&2; exit 2 ;;
esac
case "$START" in
  ''|*[!0-9]*) echo "IPV6_START must be numeric" >&2; exit 2 ;;
esac

batch=$(mktemp)
cleanup() { rm -f "$batch"; }
trap cleanup EXIT
i=0
while [ "$i" -lt "$COUNT" ]; do
  suffix=$(printf '%x' $((START + i)))
  printf 'addr replace %s/64 dev %s nodad\n' "${PREFIX}${suffix}" "$DEVICE" >> "$batch"
  i=$((i + 1))
done
ip -batch "$batch"
