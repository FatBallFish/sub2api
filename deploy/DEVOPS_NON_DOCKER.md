# DevOps Non-Docker Deployment

This guide describes the split-package deployment flow for three separately deployed services:

- New user frontend: nginx static site, default path `/var/www/sub2api-user`
- Old admin frontend: nginx static site, default path `/var/www/sub2api-admin`
- API service: local Linux systemd service, default path `/opt/sub2api/sub2api`

The scripts are intended for CI/CD or DevOps platforms that build artifacts first and then push them to target servers.

## Build Artifacts

Run commands from the repository root.

```bash
# Build all artifacts.
./deploy/package-release.sh --version v1.2.3 all

# Build only API.
./deploy/package-release.sh --version v1.2.3 api

# Build only old admin frontend.
./deploy/package-release.sh --version v1.2.3 old-frontend

# Build only new user frontend.
./deploy/package-release.sh --version v1.2.3 new-frontend
```

Default output directory:

```text
release/
  sub2api-api_<version>_linux_amd64.tar.gz
  sub2api-old-frontend_<version>.tar.gz
  sub2api-new-frontend_<version>.tar.gz
  checksums.txt
```

Useful options:

```bash
./deploy/package-release.sh --version v1.2.3 --os linux --arch arm64 api
./deploy/package-release.sh --version v1.2.3 --output-dir /tmp/sub2api-release all
./deploy/package-release.sh --version v1.2.3 --skip-install new-frontend
```

## API Server Deployment

Copy the API tarball to the target server, then:

```bash
mkdir -p /tmp/sub2api-api
tar -xzf sub2api-api_v1.2.3_linux_amd64.tar.gz -C /tmp/sub2api-api
cd /tmp/sub2api-api

sudo ./sub2api-service.sh install
sudo ./sub2api-service.sh start
sudo ./sub2api-service.sh status
```

The installer defaults to:

```text
Binary:      /opt/sub2api/sub2api
Data:        /opt/sub2api/data
Config:      /etc/sub2api
Service:     sub2api
Listen:      0.0.0.0:8080
```

Override defaults when needed:

```bash
sudo SERVER_HOST=127.0.0.1 SERVER_PORT=8080 ./sub2api-service.sh install
sudo INSTALL_DIR=/srv/sub2api SERVICE_NAME=sub2api ./sub2api-service.sh install
```

Service lifecycle commands:

```bash
sudo ./sub2api-service.sh start
sudo ./sub2api-service.sh stop
sudo ./sub2api-service.sh restart
sudo ./sub2api-service.sh status
sudo ./sub2api-service.sh logs
sudo ./sub2api-service.sh uninstall
sudo ./sub2api-service.sh uninstall --purge
```

`uninstall` keeps `/opt/sub2api` and `/etc/sub2api` by default. Use `--purge` only when configuration and local data can be removed.

## New User Frontend Deployment

Copy `sub2api-new-frontend_<version>.tar.gz` to the server:

```bash
sudo mkdir -p /var/www/sub2api-user
sudo rm -rf /var/www/sub2api-user/*
sudo tar -xzf sub2api-new-frontend_v1.2.3.tar.gz -C /var/www/sub2api-user
```

Install the nginx site example:

```bash
sudo cp /var/www/sub2api-user/nginx.example.conf /etc/nginx/sites-available/sub2api-user.conf
sudo ln -sf /etc/nginx/sites-available/sub2api-user.conf /etc/nginx/sites-enabled/sub2api-user.conf
sudo nginx -t
sudo systemctl reload nginx
```

Edit `server_name app.example.com;` before enabling the site.

## Old Admin Frontend Deployment

Copy `sub2api-old-frontend_<version>.tar.gz` to the server:

```bash
sudo mkdir -p /var/www/sub2api-admin
sudo rm -rf /var/www/sub2api-admin/*
sudo tar -xzf sub2api-old-frontend_v1.2.3.tar.gz -C /var/www/sub2api-admin
```

Install the nginx site example:

```bash
sudo cp /var/www/sub2api-admin/nginx.example.conf /etc/nginx/sites-available/sub2api-admin.conf
sudo ln -sf /etc/nginx/sites-available/sub2api-admin.conf /etc/nginx/sites-enabled/sub2api-admin.conf
sudo nginx -t
sudo systemctl reload nginx
```

Edit `server_name admin.example.com;` before enabling the site.

## nginx Routing

Both frontend site examples:

- Serve static files from their own site directory.
- Use SPA fallback: `try_files $uri $uri/ /index.html`.
- Proxy API paths to `http://127.0.0.1:8080`:
  - `/api/`
  - `/v1/`
  - `/setup/`

If the API listens on another host or port, update `proxy_pass` in both nginx configs.

## Notes

- The old frontend currently builds into `backend/internal/web/dist` by design. The packaging script uses that directory as the old admin frontend static output.
- The API package is non-embedded by default because nginx serves both frontend sites separately.
- Database and Redis are still external runtime dependencies for the API service.
