#!/usr/bin/env bash
set -euo pipefail

SING_BOX_VERSION=1.13.19
SING_BOX_SHA256=ef88a9e577d474210867bd708933d042e9b70106529df2656182c9db90106aa1
SING_BOX_ARCHIVE="sing-box-${SING_BOX_VERSION}-linux-amd64.tar.gz"
SING_BOX_URL="https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/${SING_BOX_ARCHIVE}"
INITIAL_COUNT="${1:-100}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d /tmp/ipv6-proxy-install.XXXXXX)"

cleanup() {
  if [[ "${WORK_DIR}" == /tmp/ipv6-proxy-install.* ]]; then
    rm -rf -- "${WORK_DIR}"
  fi
}
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  echo "installer must run as root" >&2
  exit 1
fi
if ! [[ "${INITIAL_COUNT}" =~ ^[1-9][0-9]*$ ]]; then
  echo "initial count must be a positive integer" >&2
  exit 1
fi

curl -fL --retry 5 --retry-all-errors --connect-timeout 10 --max-time 180 \
  -o "${WORK_DIR}/${SING_BOX_ARCHIVE}" "${SING_BOX_URL}"
printf '%s  %s\n' "${SING_BOX_SHA256}" "${WORK_DIR}/${SING_BOX_ARCHIVE}" | sha256sum -c -
tar -xzf "${WORK_DIR}/${SING_BOX_ARCHIVE}" -C "${WORK_DIR}"
install -o root -g root -m 0755 \
  "${WORK_DIR}/sing-box-${SING_BOX_VERSION}-linux-amd64/sing-box" \
  /usr/local/bin/sing-box

getent group ipv6-proxy >/dev/null || groupadd --system ipv6-proxy
id -u ipv6-proxy >/dev/null 2>&1 || \
  useradd --system --gid ipv6-proxy --home-dir /nonexistent --shell /usr/sbin/nologin ipv6-proxy

install -d -o root -g ipv6-proxy -m 2750 /etc/ipv6-proxy-manager
install -o root -g root -m 0755 "${SOURCE_DIR}/ipv6_proxyctl.py" /usr/local/sbin/ipv6-proxyctl
install -o root -g root -m 0644 \
  "${SOURCE_DIR}/systemd/ipv6-proxy-prepare.service" \
  /etc/systemd/system/ipv6-proxy-prepare.service
install -o root -g root -m 0644 \
  "${SOURCE_DIR}/systemd/ipv6-proxy.service" \
  /etc/systemd/system/ipv6-proxy.service

if [[ ! -e /etc/ipv6-proxy-manager/proxies.json ]]; then
  original_ipv6="$(ip -6 -o addr show dev eth0 scope global | awk 'NR == 1 {split($4, parts, "/"); print parts[1]}')"
  if [[ -n "${original_ipv6}" ]]; then
    ipv6-proxyctl init --count "${INITIAL_COUNT}" --reserve-ip "${original_ipv6}"
  else
    ipv6-proxyctl init --count "${INITIAL_COUNT}"
  fi
fi

chown root:root /etc/ipv6-proxy-manager/proxies.json /etc/ipv6-proxy-manager/credentials.env
chmod 0600 /etc/ipv6-proxy-manager/proxies.json /etc/ipv6-proxy-manager/credentials.env
chown root:ipv6-proxy /etc/ipv6-proxy-manager/sing-box.json
chmod 0640 /etc/ipv6-proxy-manager/sing-box.json

systemctl daemon-reload
ipv6-proxyctl prepare
systemctl enable --now ipv6-proxy-prepare.service ipv6-proxy.service
systemctl is-active --quiet ipv6-proxy.service
echo "installed ${INITIAL_COUNT} stable IPv6 SOCKS proxy mappings"
