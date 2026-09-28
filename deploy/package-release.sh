#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/release}"
VERSION="${VERSION:-}"
TARGET_OS="${TARGET_OS:-linux}"
TARGET_ARCH="${TARGET_ARCH:-amd64}"
SKIP_INSTALL=false
PNPM_CMD="${PNPM_CMD:-}"

usage() {
  cat <<'EOF'
Usage:
  ./deploy/package-release.sh [options] <api|old-frontend|new-frontend|all|clean>

Options:
  --version <version>      Package version. Defaults to backend/cmd/server/VERSION or git sha.
  --os <goos>             API target GOOS. Default: linux.
  --arch <goarch>         API target GOARCH. Default: amd64.
  --output-dir <path>     Output directory. Default: ./release.
  --skip-install          Do not install frontend dependencies automatically.
  -h, --help              Show this help.

Examples:
  ./deploy/package-release.sh --version v1.2.3 api
  ./deploy/package-release.sh --version v1.2.3 old-frontend
  ./deploy/package-release.sh --version v1.2.3 new-frontend
  ./deploy/package-release.sh --version v1.2.3 all
EOF
}

log() {
  printf '[package-release] %s\n' "$*"
}

die() {
  printf '[package-release] ERROR: %s\n' "$*" >&2
  exit 1
}

parse_args() {
  COMMAND=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        VERSION="${2:-}"
        [[ -n "$VERSION" ]] || die "--version requires a value"
        shift 2
        ;;
      --version=*)
        VERSION="${1#*=}"
        [[ -n "$VERSION" ]] || die "--version requires a value"
        shift
        ;;
      --os)
        TARGET_OS="${2:-}"
        [[ -n "$TARGET_OS" ]] || die "--os requires a value"
        shift 2
        ;;
      --arch)
        TARGET_ARCH="${2:-}"
        [[ -n "$TARGET_ARCH" ]] || die "--arch requires a value"
        shift 2
        ;;
      --output-dir)
        OUTPUT_DIR="${2:-}"
        [[ -n "$OUTPUT_DIR" ]] || die "--output-dir requires a value"
        shift 2
        ;;
      --skip-install)
        SKIP_INSTALL=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      api|old-frontend|new-frontend|all|clean)
        COMMAND="$1"
        shift
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done

  [[ -n "$COMMAND" ]] || {
    usage
    exit 1
  }
}

detect_version() {
  if [[ -n "$VERSION" ]]; then
    return
  fi
  if [[ -f "$ROOT_DIR/backend/cmd/server/VERSION" ]]; then
    VERSION="$(tr -d '\r\n' < "$ROOT_DIR/backend/cmd/server/VERSION")"
  fi
  if [[ -z "$VERSION" ]] && command -v git >/dev/null 2>&1; then
    VERSION="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  fi
  [[ -n "$VERSION" ]] || die "unable to detect version; pass --version"
}

reset_stage() {
  local stage="$1"
  rm -rf "$stage"
  mkdir -p "$stage"
}

ensure_output_dir() {
  mkdir -p "$OUTPUT_DIR"
}

run_old_frontend_install() {
  if [[ "$SKIP_INSTALL" == true ]]; then
    return
  fi
  if [[ -f "$ROOT_DIR/pnpm-lock.yaml" || -f "$ROOT_DIR/frontend/pnpm-lock.yaml" ]]; then
    log "installing old frontend dependencies with pnpm"
    run_pnpm --dir "$ROOT_DIR/frontend" install --frozen-lockfile
  fi
}

run_pnpm() {
  if [[ -n "$PNPM_CMD" ]]; then
    CI=true $PNPM_CMD "$@"
    return
  fi
  if command -v pnpm >/dev/null 2>&1; then
    local pnpm_version
    pnpm_version="$(pnpm --version 2>/dev/null || true)"
    case "$pnpm_version" in
      9.*|10.*|11.*)
        CI=true pnpm "$@"
        return
        ;;
    esac
  fi
  if command -v corepack >/dev/null 2>&1; then
    CI=true corepack pnpm@10.26.1 "$@"
    return
  fi
  die "pnpm is required for the old frontend build. Install pnpm or enable corepack."
}

run_new_frontend_install() {
  if [[ "$SKIP_INSTALL" == true ]]; then
    return
  fi
  if [[ -f "$ROOT_DIR/frontend-new/package-lock.json" ]]; then
    log "installing new frontend dependencies with npm ci"
    npm --prefix "$ROOT_DIR/frontend-new" ci
  fi
}

package_api() {
  detect_version
  ensure_output_dir

  local stage="$OUTPUT_DIR/.stage-api"
  local archive="$OUTPUT_DIR/sub2api-api_${VERSION}_${TARGET_OS}_${TARGET_ARCH}.tar.gz"
  reset_stage "$stage"

  log "building API binary for ${TARGET_OS}/${TARGET_ARCH}"
  mkdir -p "$ROOT_DIR/backend/bin"
  (
    cd "$ROOT_DIR/backend"
    CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" \
      go build -ldflags="-s -w -X main.Version=${VERSION}" -trimpath -o "$stage/sub2api" ./cmd/server
  )

  log "assembling API package"
  chmod +x "$stage/sub2api"
  cp "$ROOT_DIR/deploy/sub2api-service.sh" "$stage/sub2api-service.sh"
  chmod +x "$stage/sub2api-service.sh"
  cp "$ROOT_DIR/deploy/sub2api.service" "$stage/sub2api.service"
  cp "$ROOT_DIR/deploy/config.example.yaml" "$stage/config.example.yaml"
  cp -R "$ROOT_DIR/backend/migrations" "$stage/migrations"
  cat > "$stage/README.txt" <<EOF
Sub2API API package ${VERSION}

Install or upgrade on a Linux systemd host:
  sudo ./sub2api-service.sh install
  sudo ./sub2api-service.sh restart

Useful commands:
  sudo ./sub2api-service.sh status
  sudo ./sub2api-service.sh logs
  sudo ./sub2api-service.sh uninstall

Default paths:
  /opt/sub2api/sub2api
  /etc/sub2api
EOF

  log "creating $archive"
  tar -czf "$archive" -C "$stage" .
}

write_frontend_readme() {
  local target="$1"
  local name="$2"
  local site_dir="$3"
  cat > "$target/README.txt" <<EOF
${name} static frontend package ${VERSION}

Suggested nginx site directory:
  ${site_dir}

Deploy:
  sudo mkdir -p ${site_dir}
  sudo tar -xzf <this-package>.tar.gz -C ${site_dir}
  sudo nginx -t
  sudo systemctl reload nginx

The nginx example in nginx.example.conf proxies /api, /v1, and /setup to http://127.0.0.1:8080.
EOF
}

package_old_frontend() {
  detect_version
  ensure_output_dir
  run_old_frontend_install

  local stage="$OUTPUT_DIR/.stage-old-frontend"
  local archive="$OUTPUT_DIR/sub2api-old-frontend_${VERSION}.tar.gz"
  reset_stage "$stage"

  log "building old admin frontend"
  run_pnpm --dir "$ROOT_DIR/frontend" run build

  [[ -f "$ROOT_DIR/backend/internal/web/dist/index.html" ]] || die "old frontend dist not found"
  cp -R "$ROOT_DIR/backend/internal/web/dist/." "$stage/"
  cp "$ROOT_DIR/deploy/nginx/admin-frontend.example.conf" "$stage/nginx.example.conf"
  write_frontend_readme "$stage" "Sub2API old admin frontend" "/var/www/sub2api-admin"

  log "creating $archive"
  tar -czf "$archive" -C "$stage" .
}

package_new_frontend() {
  detect_version
  ensure_output_dir
  run_new_frontend_install

  local stage="$OUTPUT_DIR/.stage-new-frontend"
  local archive="$OUTPUT_DIR/sub2api-new-frontend_${VERSION}.tar.gz"
  reset_stage "$stage"

  log "building new user frontend"
  npm --prefix "$ROOT_DIR/frontend-new" run build

  [[ -f "$ROOT_DIR/frontend-new/dist/index.html" ]] || die "new frontend dist not found"
  cp -R "$ROOT_DIR/frontend-new/dist/." "$stage/"
  cp "$ROOT_DIR/deploy/nginx/user-frontend.example.conf" "$stage/nginx.example.conf"
  write_frontend_readme "$stage" "Sub2API new user frontend" "/var/www/sub2api-user"

  log "creating $archive"
  tar -czf "$archive" -C "$stage" .
}

write_checksums() {
  ensure_output_dir
  log "writing checksums"
  (
    cd "$OUTPUT_DIR"
    rm -f checksums.txt
    for file in sub2api-api_*.tar.gz sub2api-old-frontend_*.tar.gz sub2api-new-frontend_*.tar.gz; do
      [[ -f "$file" ]] || continue
      if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" >> checksums.txt
      else
        shasum -a 256 "$file" >> checksums.txt
      fi
    done
  )
}

clean_output() {
  log "cleaning $OUTPUT_DIR"
  rm -rf "$OUTPUT_DIR"
}

main() {
  parse_args "$@"
  case "$COMMAND" in
    api)
      package_api
      write_checksums
      ;;
    old-frontend)
      package_old_frontend
      write_checksums
      ;;
    new-frontend)
      package_new_frontend
      write_checksums
      ;;
    all)
      package_api
      package_old_frontend
      package_new_frontend
      write_checksums
      ;;
    clean)
      clean_output
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
