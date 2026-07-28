#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-sub2api}"
SERVICE_USER="${SERVICE_USER:-sub2api}"
INSTALL_DIR="${INSTALL_DIR:-/opt/sub2api}"
CONFIG_DIR="${CONFIG_DIR:-/etc/sub2api}"
SERVER_HOST="${SERVER_HOST:-0.0.0.0}"
SERVER_PORT="${SERVER_PORT:-8080}"
GIN_MODE="${GIN_MODE:-release}"
SOURCE_BINARY="${SOURCE_BINARY:-}"
PURGE=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
Usage:
  sudo ./sub2api-service.sh <command> [options]

Commands:
  install      Install or upgrade the API binary and systemd service
  start        Start the systemd service
  stop         Stop the systemd service
  restart      Restart the systemd service
  status       Show service status
  logs         Follow service logs
  uninstall    Remove the systemd service; add --purge to remove files

Options:
  --binary <path>        Binary to install. Defaults to ./sub2api beside this script.
  --install-dir <path>   Default: ${INSTALL_DIR}
  --config-dir <path>    Default: ${CONFIG_DIR}
  --service-name <name>  Default: ${SERVICE_NAME}
  --service-user <user>  Default: ${SERVICE_USER}
  --host <host>          Default: ${SERVER_HOST}
  --port <port>          Default: ${SERVER_PORT}
  --purge                With uninstall, also remove install and config directories.
  -h, --help             Show this help.

Environment overrides:
  INSTALL_DIR CONFIG_DIR SERVICE_NAME SERVICE_USER SERVER_HOST SERVER_PORT GIN_MODE SOURCE_BINARY
EOF
}

log() {
  printf '[sub2api-service] %s\n' "$*"
}

die() {
  printf '[sub2api-service] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "please run as root, for example: sudo $0 $COMMAND"
  fi
}

require_systemd() {
  command -v systemctl >/dev/null 2>&1 || die "systemctl is required"
}

parse_args() {
  COMMAND="${1:-}"
  if [[ -z "$COMMAND" ]]; then
    usage
    exit 1
  fi
  shift || true

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --binary)
        SOURCE_BINARY="${2:-}"
        [[ -n "$SOURCE_BINARY" ]] || die "--binary requires a path"
        shift 2
        ;;
      --install-dir)
        INSTALL_DIR="${2:-}"
        [[ -n "$INSTALL_DIR" ]] || die "--install-dir requires a path"
        shift 2
        ;;
      --config-dir)
        CONFIG_DIR="${2:-}"
        [[ -n "$CONFIG_DIR" ]] || die "--config-dir requires a path"
        shift 2
        ;;
      --service-name)
        SERVICE_NAME="${2:-}"
        [[ -n "$SERVICE_NAME" ]] || die "--service-name requires a name"
        shift 2
        ;;
      --service-user)
        SERVICE_USER="${2:-}"
        [[ -n "$SERVICE_USER" ]] || die "--service-user requires a user"
        shift 2
        ;;
      --host)
        SERVER_HOST="${2:-}"
        [[ -n "$SERVER_HOST" ]] || die "--host requires a value"
        shift 2
        ;;
      --port)
        SERVER_PORT="${2:-}"
        [[ "$SERVER_PORT" =~ ^[0-9]+$ ]] || die "--port must be numeric"
        shift 2
        ;;
      --purge)
        PURGE=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1"
        ;;
    esac
  done
}

create_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    log "user exists: $SERVICE_USER"
    return
  fi

  log "creating system user: $SERVICE_USER"
  if command -v useradd >/dev/null 2>&1; then
    useradd -r -s /bin/sh -d "$INSTALL_DIR" "$SERVICE_USER"
  else
    die "useradd is required to create $SERVICE_USER"
  fi
}

install_files() {
  local binary="$SOURCE_BINARY"
  if [[ -z "$binary" ]]; then
    binary="$SCRIPT_DIR/sub2api"
  fi
  [[ -f "$binary" ]] || die "binary not found: $binary"

  log "installing binary to $INSTALL_DIR/sub2api"
  mkdir -p "$INSTALL_DIR" "$INSTALL_DIR/data" "$CONFIG_DIR"
  install -m 0755 "$binary" "$INSTALL_DIR/sub2api"

  if [[ -d "$SCRIPT_DIR/migrations" ]]; then
    log "installing migrations"
    rm -rf "$INSTALL_DIR/migrations"
    cp -R "$SCRIPT_DIR/migrations" "$INSTALL_DIR/migrations"
  fi

  if [[ -f "$SCRIPT_DIR/config.example.yaml" ]]; then
    install -m 0644 "$SCRIPT_DIR/config.example.yaml" "$CONFIG_DIR/config.example.yaml"
  fi

  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$CONFIG_DIR"
}

write_service_unit() {
  local unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
  log "writing systemd unit: $unit_path"
  cat > "$unit_path" <<EOF
[Unit]
Description=Sub2API - AI API Gateway Platform
After=network.target postgresql.service redis.service
Wants=postgresql.service redis.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/sub2api
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${INSTALL_DIR} ${CONFIG_DIR}

Environment=GIN_MODE=${GIN_MODE}
Environment=SERVER_HOST=${SERVER_HOST}
Environment=SERVER_PORT=${SERVER_PORT}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

install_service() {
  require_root
  require_systemd
  create_user

  local was_active=false
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    was_active=true
    log "stopping active service before install"
    systemctl stop "$SERVICE_NAME"
  fi

  install_files
  write_service_unit
  systemctl enable "$SERVICE_NAME" >/dev/null

  if [[ "$was_active" == true ]]; then
    log "starting service after upgrade"
    systemctl start "$SERVICE_NAME"
  fi

  log "installed. Use: sudo systemctl start $SERVICE_NAME"
}

uninstall_service() {
  require_root
  require_systemd
  log "stopping and disabling service"
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload

  if [[ "$PURGE" == true ]]; then
    log "purging $INSTALL_DIR and $CONFIG_DIR"
    rm -rf "$INSTALL_DIR" "$CONFIG_DIR"
    userdel "$SERVICE_USER" 2>/dev/null || true
  else
    log "kept files: $INSTALL_DIR and $CONFIG_DIR"
  fi
}

run_systemctl() {
  require_root
  require_systemd
  systemctl "$1" "$SERVICE_NAME"
}

main() {
  parse_args "$@"
  case "$COMMAND" in
    install)
      install_service
      ;;
    start|stop|restart|status)
      run_systemctl "$COMMAND"
      ;;
    logs)
      require_root
      require_systemd
      journalctl -u "$SERVICE_NAME" -f
      ;;
    uninstall|remove)
      uninstall_service
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
