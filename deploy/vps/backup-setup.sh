#!/bin/sh
# One-time setup of the nightly Google Drive backup of the Tadabbor server (run again any time to update it).
#   sudo sh /opt/tadabbor/src/deploy/vps/backup-setup.sh
#   sudo sh .../backup-setup.sh --reconnect      (connect Google Drive again, e.g. after you removed the access in your Google account)
#   sudo RCLONE_ZIP=/root/rclone.zip sh ...      (if this server cannot download from github.com)
#
# What it adds, all apart from the rest of the server:
#   /opt/tadabbor/bin/rclone                the rclone program (its own copy; the server's other rclone, if any, is not used or changed)
#   /opt/tadabbor/bin/tadabbor-backup       deploy/vps/backup.sh, plus a link /usr/local/bin/tadabbor-backup
#   /opt/tadabbor/backup/                   settings (backup.conf), the Google Drive key (rclone.conf), the last 3 backups
#   tadabbor-backup.service + .timer        runs as the tadabbor user every night at 04:30 Iran time
# Google Drive access uses the "drive.file" permission: rclone sees only the files it made itself, never the rest of your Drive.
set -eu

RCLONE_VERSION="${RCLONE_VERSION:-1.68.2}"
BASE=/opt/tadabbor
B=$BASE/backup
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
TB=tadabbor
REMOTE_NAME=tadabbor-gdrive
# {"scope":"drive.file"} for "rclone authorize"
AUTH_ARG=eyJzY29wZSI6ImRyaXZlLmZpbGUifQ

[ "$(id -u)" = 0 ] || { echo "Run as root: sudo sh $0"; exit 1; }
id $TB >/dev/null 2>&1 && [ -d $BASE/pb_data ] || { echo "Install the server first: sudo sh $SRC/deploy/vps/install.sh"; exit 1; }
for c in python3 curl tar gzip openssl flock runuser; do command -v $c >/dev/null || { echo "Missing program: $c"; exit 1; }; done

# 1) rclone, checked against the release's SHA256SUMS
case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;; esac
if ! $BASE/bin/rclone version 2>/dev/null | head -n 1 | grep -q "v$RCLONE_VERSION\$"; then
  PKG="rclone-v$RCLONE_VERSION-linux-$ARCH"
  TMPD=$(mktemp -d)
  if [ -n "${RCLONE_ZIP:-}" ]; then cp "$RCLONE_ZIP" "$TMPD/$PKG.zip"
  else
    URL="https://github.com/rclone/rclone/releases/download/v$RCLONE_VERSION"
    curl -fsSL --retry 3 -o "$TMPD/$PKG.zip" "$URL/$PKG.zip" && curl -fsSL --retry 3 -o "$TMPD/SHA256SUMS" "$URL/SHA256SUMS" \
      || { echo "Download failed. Download $PKG.zip elsewhere and run again with RCLONE_ZIP=/path/to/zip"; rm -rf "$TMPD"; exit 1; }
    (cd "$TMPD" && grep " $PKG.zip\$" SHA256SUMS | sha256sum -c --quiet -) || { echo "The download is damaged (checksum mismatch)"; rm -rf "$TMPD"; exit 1; }
  fi
  if command -v unzip >/dev/null; then unzip -oqj "$TMPD/$PKG.zip" "$PKG/rclone" -d "$TMPD"
  else python3 -I -c "import sys,zipfile; open(sys.argv[3],'wb').write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))" "$TMPD/$PKG.zip" "$PKG/rclone" "$TMPD/rclone"; fi
  install -m 755 -o root -g root "$TMPD/rclone" $BASE/bin/rclone
  rm -rf "$TMPD"
fi
$BASE/bin/rclone version | head -n 1

# 2) The backup tool and its folder
install -m 755 -o root -g root "$SRC/deploy/vps/backup.sh" $BASE/bin/tadabbor-backup
ln -sf $BASE/bin/tadabbor-backup /usr/local/bin/tadabbor-backup
mkdir -p $B/local
chown $TB:$TB $B $B/local && chmod 700 $B
if [ ! -f $B/backup.conf ]; then
  cat > $B/backup.conf <<'EOF'
# Settings of tadabbor-backup (read by the nightly backup; root can change them, the tadabbor user can only read them).
# Google Drive folder: <rclone remote>:<folder>
REMOTE="tadabbor-gdrive:Tadabbor-backups"
# How many backups to keep on Drive
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_MONTHLY=12
# How many to keep on this server too
KEEP_LOCAL=3
# 1 = also back up PocketBase's request logs (auxiliary.db); usually not needed
INCLUDE_LOGS=0
# Optional: encrypt backups before upload. Keep this password somewhere safe outside the server:
# without it, encrypted backups cannot be restored. Leave empty for no encryption.
BACKUP_PASSWORD=""
# Optional: a ping URL (for example from healthchecks.io) that emails you when a nightly backup is missed or fails
HEALTHCHECK_URL=""
# Port of tadabbor-api (the same as in install.sh)
PORT=8095
EOF
fi
chown root:$TB $B/backup.conf && chmod 640 $B/backup.conf

# 3) Google Drive access (once): the token is written straight into rclone.conf on this server, it is never shown or sent anywhere else
if [ "${1:-}" = --reconnect ] || ! grep -q "^\[$REMOTE_NAME\]" $B/rclone.conf 2>/dev/null; then
  cat <<EOF

==== Connect Google Drive (once) ====
Keep this window open. You need a browser on the device you are connecting from, with an SSH tunnel to this server:
  - From a computer, in a NEW terminal:   ssh -p <ssh port> -L 53682:127.0.0.1:53682 <user>@<server ip>
  - From a phone app such as Termius:     Port forwarding -> Local -> local port 53682 -> 127.0.0.1 : 53682
Then open the http://127.0.0.1:53682/auth?... link printed below in that device's browser,
choose your Google account and press Allow. This window continues by itself.
(No tunnel possible? Press Ctrl+C and run again with TOKEN_PASTE=1, see BACKUP.md.)

EOF
  OUTF=$(mktemp)
  if [ "${TOKEN_PASTE:-}" = 1 ]; then
    echo "On a computer with rclone, run:   rclone authorize \"drive\" \"$AUTH_ARG\""
    echo "and paste here the line it prints between ---> and <---End paste (it stays on this server):"
    read -r TOKEN
  else
    runuser -u $TB -- env HOME=$B $BASE/bin/rclone authorize drive "$AUTH_ARG" --auth-no-open-browser 2>&1 | tee "$OUTF"
    TOKEN=$(sed -n '/--->/,/<---End paste/p' "$OUTF" | sed '1d;$d' | tr -d ' \r\n')
  fi
  # rclone prints either the token itself or a base64 blob holding it; keep only the token
  TOKEN=$(printf '%s' "$TOKEN" | python3 -I -c '
import base64, json, sys
s = sys.stdin.read().strip()
if not s.startswith("{"):
    s = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode()
    s = json.loads(s).get("token", s)
t = json.loads(s)
assert t.get("access_token") and t.get("refresh_token")
print(json.dumps(t, separators=(",", ":")))
' 2>/dev/null) || TOKEN=""
  rm -f "$OUTF"
  [ -n "$TOKEN" ] || { echo "No Google token received; nothing changed. Run this script again."; exit 1; }
  umask 077
  printf '[%s]\ntype = drive\nscope = drive.file\ntoken = %s\n\n' "$REMOTE_NAME" "$TOKEN" > $B/rclone.conf.new
  chown $TB:$TB $B/rclone.conf.new && mv $B/rclone.conf.new $B/rclone.conf
  umask 022
  TOKEN=""
  echo "Google Drive connected."
fi
chown $TB:$TB $B/rclone.conf && chmod 600 $B/rclone.conf

. $B/backup.conf
runuser -u $TB -- env HOME=$B RCLONE_CONFIG=$B/rclone.conf $BASE/bin/rclone mkdir "$REMOTE/daily" \
  || { echo "Cannot reach the Google Drive folder. Connect again: sudo sh $0 --reconnect"; exit 1; }

# 4) Nightly timer
cat > /etc/systemd/system/tadabbor-backup.service <<EOF
[Unit]
Description=Tadabbor backup to Google Drive
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$TB
Group=$TB
ExecStart=/bin/sh $BASE/bin/tadabbor-backup run
TimeoutStartSec=1h
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$B $BASE/pb_data
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
MemoryMax=384M
CPUQuota=60%
EOF
cat > /etc/systemd/system/tadabbor-backup.timer <<'EOF'
[Unit]
Description=Nightly Tadabbor backup to Google Drive

[Timer]
OnCalendar=*-*-* 04:30:00 Asia/Tehran
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now tadabbor-backup.timer >/dev/null 2>&1

# 5) First backup now
echo
echo "Making the first backup..."
if systemctl start tadabbor-backup.service; then
  journalctl -u tadabbor-backup -n 20 --no-pager -o cat | grep -v '^$' | tail -n 12
  echo
  tadabbor-backup status
  echo
  echo "OK: backups run every night at about 04:30 Iran time. In Google Drive see the folder ${REMOTE#*:}."
else
  journalctl -u tadabbor-backup -n 30 --no-pager -o cat
  echo "The first backup failed (see above). Fix it and try: sudo tadabbor-backup run"
  exit 1
fi
