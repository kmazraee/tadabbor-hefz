#!/bin/sh
# Installs (or updates) the Tadabbor accounts server on this VPS, kept apart from everything else on it:
#   - its own Linux user "tadabbor" (no login shell) and its own folder /opt/tadabbor
#   - listens only on 127.0.0.1:PORT, so nothing reaches it except through the nginx site in nginx-api.conf
#   - a systemd service "tadabbor-api" sandboxed to write only /opt/tadabbor/pb_data, with memory and CPU caps
# It does not install packages, touch nginx, the firewall or any other service.
#
#   sudo sh deploy/vps/install.sh                 (from a checkout of the repository)
#   sudo PORT=8096 sh deploy/vps/install.sh       (if 8095 is taken)
#   sudo PB_ZIP=/root/pocketbase.zip sh ...       (if this server cannot download from github.com)
set -eu

PB_VERSION="${PB_VERSION:-0.40.6}"
PORT="${PORT:-8095}"
BASE=/opt/tadabbor
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
SVC=tadabbor-api

[ "$(id -u)" = 0 ] || { echo "Run as root: sudo sh $0"; exit 1; }
[ -d "$SRC/deploy/pocketbase/pb_hooks" ] || { echo "Run this from a checkout of the tadabbor-hefz repository"; exit 1; }

# The port must be free (or already ours)
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q "[:.]$PORT\$" && ! systemctl is-active --quiet $SVC; then
  echo "Port $PORT is already used by another program. Choose another: sudo PORT=8096 sh $0"; exit 1
fi

id tadabbor >/dev/null 2>&1 || useradd --system --home-dir $BASE --no-create-home --shell /usr/sbin/nologin tadabbor
mkdir -p $BASE/bin $BASE/pb_data

# PocketBase (one file)
case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;; esac
if ! $BASE/bin/pocketbase --version 2>/dev/null | grep -q "$PB_VERSION"; then
  ZIP="${PB_ZIP:-}"
  if [ -z "$ZIP" ]; then
    ZIP=$(mktemp)
    curl -fL --retry 3 -o "$ZIP" "https://github.com/pocketbase/pocketbase/releases/download/v$PB_VERSION/pocketbase_${PB_VERSION}_linux_$ARCH.zip" \
      || { echo "Download failed. Download the zip elsewhere and run again with PB_ZIP=/path/to/zip"; exit 1; }
  fi
  TMPD=$(mktemp -d)
  if command -v unzip >/dev/null; then unzip -oq "$ZIP" pocketbase -d "$TMPD"
  else python3 -c "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extract('pocketbase', sys.argv[2])" "$ZIP" "$TMPD"; fi
  install -m 755 "$TMPD/pocketbase" $BASE/bin/pocketbase
  rm -rf "$TMPD"; [ -n "${PB_ZIP:-}" ] || rm -f "$ZIP"
fi
$BASE/bin/pocketbase --version

# App code: copied out of the checkout, so the service never reads the git folder
rm -rf $BASE/app.new && mkdir -p $BASE/app.new
cp -r "$SRC/deploy/pocketbase/pb_migrations" "$SRC/deploy/pocketbase/pb_hooks" $BASE/app.new/
rm -rf $BASE/app && mv $BASE/app.new $BASE/app

# Settings (kept across updates)
if [ ! -f $BASE/tadabbor.env ]; then
  cp "$SRC/deploy/vps/tadabbor.env.example" $BASE/tadabbor.env
  SECRET=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)
  sed -i "s|^OTP_SECRET=.*|OTP_SECRET=$SECRET|" $BASE/tadabbor.env
  echo "Created $BASE/tadabbor.env (SMS and Google settings go there)"
fi
chown root:root $BASE/tadabbor.env && chmod 600 $BASE/tadabbor.env
chown -R root:root $BASE/bin $BASE/app && chmod -R go-w $BASE/app
chown -R tadabbor:tadabbor $BASE/pb_data && chmod 700 $BASE/pb_data

cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Tadabbor app accounts and sync (PocketBase)
After=network-online.target
Wants=network-online.target

[Service]
User=tadabbor
Group=tadabbor
EnvironmentFile=$BASE/tadabbor.env
ExecStart=$BASE/bin/pocketbase serve --http=127.0.0.1:$PORT --dir=$BASE/pb_data --migrationsDir=$BASE/app/pb_migrations --hooksDir=$BASE/app/pb_hooks --hooksWatch=false --automigrate=false
Restart=on-failure
RestartSec=3

# Kept apart from the rest of the server
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$BASE/pb_data
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallArchitectures=native
MemoryMax=512M
CPUQuota=100%
TasksMax=256
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SVC >/dev/null 2>&1
systemctl restart $SVC

i=0
until curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; do
  i=$((i + 1)); [ $i -lt 20 ] || { echo "The service did not start. See: journalctl -u $SVC -n 50"; exit 1; }
  sleep 1
done
echo
echo "OK: tadabbor-api is running on 127.0.0.1:$PORT"
curl -s "http://127.0.0.1:$PORT/api/hefz/methods"; echo
echo "Next: the nginx site (deploy/vps/nginx-api.conf) and an admin account (deploy/vps/README.md)."
