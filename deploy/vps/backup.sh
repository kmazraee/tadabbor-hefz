#!/bin/sh
# Backups of the Tadabbor accounts server (PocketBase data) to Google Drive, and restore from them.
# Installed by backup-setup.sh as /opt/tadabbor/bin/tadabbor-backup; the timer tadabbor-backup.timer runs "run" every night.
#
#   sudo tadabbor-backup run              make a backup now and upload it
#   sudo tadabbor-backup status           when the last backup was made, and the next one
#   sudo tadabbor-backup list             the backups on Google Drive
#   sudo tadabbor-backup verify [NAME]    download a backup (default: the newest) and check it, without changing anything
#   sudo tadabbor-backup restore [NAME]   put a backup back in place of the live data (the current data is kept aside)
#
# What is backed up: pb_data/data.db (users, sync data, usage stats; copied with SQLite's online backup, so it is
# consistent while the server runs) and pb_data/storage (uploaded files). Not: PocketBase's own backups folder,
# the logs database (auxiliary.db, unless INCLUDE_LOGS=1) and tadabbor.env (keep a copy of it yourself).
# Drive layout: <REMOTE>/daily (newest KEEP_DAILY), /weekly (one a week, KEEP_WEEKLY), /monthly (one a month, KEEP_MONTHLY).
# Only touches /opt/tadabbor/backup, its own rclone config and its own folder on Drive.
set -eu

BASE="${BASE:-/opt/tadabbor}"
B="$BASE/backup"
PB_DATA="$BASE/pb_data"
SVC=tadabbor-api
TB=tadabbor

# Settings: backup.conf (root:tadabbor 640) may change any of these
REMOTE="tadabbor-gdrive:Tadabbor-backups"
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_MONTHLY=12
KEEP_LOCAL=3
INCLUDE_LOGS=0
BACKUP_PASSWORD=""
HEALTHCHECK_URL=""
PORT=8095
[ -f "$B/backup.conf" ] && . "$B/backup.conf"
[ -n "$BACKUP_PASSWORD" ] && export BACKUP_PASSWORD
RCLONE="${RCLONE:-$BASE/bin/rclone}"
export RCLONE_CONFIG="$B/rclone.conf" HOME="$B"
TZNAME=Asia/Tehran

CMD="${1:-status}"
[ $# -gt 0 ] && shift

# Everything except restore runs as the tadabbor user, so every file stays owned by it
if [ "$(id -u)" = 0 ] && [ "$CMD" != restore ]; then
  exec runuser -u $TB -- sh "$0" "$CMD" "$@"
fi
if [ "$(id -u)" = 0 ]; then tb() { runuser -u $TB -- env HOME="$B" RCLONE_CONFIG="$RCLONE_CONFIG" "$@"; }
else tb() { "$@"; }; fi
rc() { tb "$RCLONE" --retries 5 --low-level-retries 10 --stats 0 "$@"; }

say() { echo "$(TZ=$TZNAME date '+%Y-%m-%d %H:%M') $*"; }
die() { say "ERROR: $*" >&2; exit 1; }

# SQLite helpers (Python's sqlite3 is part of Ubuntu): snapshot SRC DST | check DB
PYCODE='
import sqlite3, sys
def check(path):
    db = sqlite3.connect(path)
    r = db.execute("PRAGMA integrity_check").fetchone()[0]
    if r != "ok":
        sys.exit("integrity check failed: " + r)
    t = {n for (n,) in db.execute("select name from sqlite_master where type=\"table\"")}
    out = []
    for name in ("users", "hefz_sync", "hefz_sessions"):
        if name in t:
            out.append("%s=%d" % (name, db.execute("select count(*) from " + name).fetchone()[0]))
    db.close()
    return " ".join(out)
if sys.argv[1] == "snapshot":
    src = sqlite3.connect(sys.argv[2], timeout=60)
    dst = sqlite3.connect(sys.argv[3])
    src.backup(dst)
    src.close()
    dst.execute("PRAGMA journal_mode=DELETE")
    dst.close()
    print(check(sys.argv[3]))
else:
    print(check(sys.argv[2]))
'
py() { python3 -I -c "$PYCODE" "$@"; }

ping_hc() {
  [ -n "$HEALTHCHECK_URL" ] || return 0
  curl -fsS -m 15 --retry 2 -o /dev/null "$HEALTHCHECK_URL$1" 2>/dev/null || true
}

# Newest first; names are tadabbor-YYYY-MM-DD_HHMM.tar.gz[.enc], so name order is date order
remote_list() { rc lsf --files-only "$REMOTE/$1" 2>/dev/null | grep '^tadabbor-' | sort -r || true; }

prune_remote() {
  remote_list "$1" | tail -n +"$(($2 + 1))" | while read -r f; do
    rc deletefile "$REMOTE/$1/$f" && say "removed old $1/$f"
  done
}

find_backup() {   # NAME or "latest" -> prints folder/name
  want="${1:-latest}"
  for f in daily weekly monthly; do
    remote_list $f | while read -r n; do echo "$n $f/$n"; done
  done | sort -r | {
    if [ "$want" = latest ]; then head -n 1 | cut -d' ' -f2
    else awk -v w="$want" '$1 == w || $1 == w".tar.gz" || $1 == w".tar.gz.enc" { print $2; exit }'; fi
  }
}

# Downloads (or takes a local file) and unpacks it into $1/pb_data; prints the manifest
fetch_unpack() {
  dir="$1"; want="${2:-latest}"
  tb mkdir -p "$dir"
  if [ -f "$want" ]; then file="$want"
  elif [ -f "$B/local/$want" ]; then file="$B/local/$want"
  else
    path=$(find_backup "$want")
    [ -n "$path" ] || die "no backup named '$want' on Google Drive (see: tadabbor-backup list)"
    say "downloading $path"
    file="$dir/$(basename "$path")"
    rc copyto "$REMOTE/$path" "$file"
  fi
  case "$file" in
    *.enc)
      [ -n "$BACKUP_PASSWORD" ] || die "this backup is encrypted: put BACKUP_PASSWORD in $B/backup.conf"
      tb sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSWORD -in "$1" | tar -xzf - -C "$2"' sh "$file" "$dir" \
        || die "could not decrypt (wrong BACKUP_PASSWORD?)" ;;
    *) tb tar -xzf "$file" -C "$dir" ;;
  esac
  [ -f "$dir/pb_data/data.db" ] || die "the backup has no pb_data/data.db"
  counts=$(tb python3 -I -c "$PYCODE" check "$dir/pb_data/data.db") || die "the database in the backup is damaged"
  say "backup $(basename "$file") is good: $counts"
  [ -f "$dir/manifest.txt" ] && sed 's/^/    /' "$dir/manifest.txt"
  return 0
}

case "$CMD" in
run)
  [ -x "$RCLONE" ] || die "rclone is missing: sudo sh /opt/tadabbor/src/deploy/vps/backup-setup.sh"
  [ -f "$PB_DATA/data.db" ] || die "no database at $PB_DATA/data.db"
  mkdir -p "$B/local" "$B/work"
  exec 9>"$B/.lock"
  flock -n 9 || die "another backup is running"
  TS=$(TZ=$TZNAME date +%Y-%m-%d_%H%M)
  W="$B/work/$TS"
  NAME="tadabbor-$TS.tar.gz"; [ -n "$BACKUP_PASSWORD" ] && NAME="$NAME.enc"
  OUT="$B/local/$NAME"
  ok=0
  trap 'rm -rf "$W" "$OUT.part"; if [ $ok = 0 ]; then echo "fail $(TZ=$TZNAME date "+%Y-%m-%d %H:%M") $NAME" > "$B/status"; ping_hc /fail; fi' EXIT
  ping_hc /start
  rm -rf "$W"; mkdir -p "$W/pb_data"

  say "snapshot of the database"
  counts=$(py snapshot "$PB_DATA/data.db" "$W/pb_data/data.db") || die "snapshot failed"
  if [ "$INCLUDE_LOGS" = 1 ] && [ -f "$PB_DATA/auxiliary.db" ]; then py snapshot "$PB_DATA/auxiliary.db" "$W/pb_data/auxiliary.db" >/dev/null; fi
  [ -d "$PB_DATA/storage" ] && cp -a "$PB_DATA/storage" "$W/pb_data/"
  {
    echo "made: $(TZ=$TZNAME date '+%Y-%m-%d %H:%M') (Iran time)"
    echo "server: $(hostname)"
    echo "pocketbase: $("$BASE/bin/pocketbase" --version 2>/dev/null || echo '?')"
    echo "records: $counts"
    echo "encrypted: $([ -n "$BACKUP_PASSWORD" ] && echo yes || echo no)"
  } > "$W/manifest.txt"

  if [ -n "$BACKUP_PASSWORD" ]; then
    tar -czf - -C "$W" pb_data manifest.txt | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSWORD -out "$OUT.part"
  else
    tar -czf "$OUT.part" -C "$W" pb_data manifest.txt
  fi
  # Read the archive back before it leaves the server
  if [ -n "$BACKUP_PASSWORD" ]; then
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSWORD -in "$OUT.part" | tar -tzf - > "$W/list" || die "the new archive cannot be read back"
  else
    tar -tzf "$OUT.part" > "$W/list" || die "the new archive cannot be read back"
  fi
  grep -qx 'pb_data/data.db' "$W/list" || die "the new archive has no database in it"
  mv "$OUT.part" "$OUT"
  SIZE=$(du -h "$OUT" | cut -f1)
  say "made $NAME ($SIZE, $counts)"

  say "uploading to Google Drive"
  rc copyto "$OUT" "$REMOTE/daily/$NAME" || die "upload failed (see the lines above)"

  # One copy a week and one a month, copied on Drive itself (nothing is uploaded twice)
  week_ago=$(TZ=$TZNAME date -d '6 days ago' +%Y-%m-%d)
  last_w=$(remote_list weekly | head -n 1 | sed 's/^tadabbor-//; s/_.*//')
  if [ -z "$last_w" ] || [ "$last_w" \< "$week_ago" ]; then
    rc copyto "$REMOTE/daily/$NAME" "$REMOTE/weekly/$NAME" && say "kept as this week's backup"
  fi
  month=$(TZ=$TZNAME date +%Y-%m)
  if ! remote_list monthly | grep -q "^tadabbor-$month-"; then
    rc copyto "$REMOTE/daily/$NAME" "$REMOTE/monthly/$NAME" && say "kept as this month's backup"
  fi

  prune_remote daily "$KEEP_DAILY"
  prune_remote weekly "$KEEP_WEEKLY"
  prune_remote monthly "$KEEP_MONTHLY"
  ls -1 "$B/local" | grep '^tadabbor-' | sort -r | tail -n +"$((KEEP_LOCAL + 1))" | while read -r f; do rm -f "$B/local/$f"; done

  echo "ok $(TZ=$TZNAME date '+%Y-%m-%d %H:%M') $NAME $SIZE $counts" > "$B/status"
  ok=1
  ping_hc ""
  say "OK: backup done"
  ;;

status)
  if [ -f "$B/status" ]; then
    set -- $(cat "$B/status")
    if [ "$1" = ok ]; then echo "Last backup: OK on $2 $3 (Iran time): $4, $5"
    else echo "LAST BACKUP FAILED on $2 $3 (Iran time). Details: journalctl -u tadabbor-backup -n 50"; fi
    last_ok=$(find "$B/status" -mmin -2160 2>/dev/null)
    [ "$1" = ok ] && [ -z "$last_ok" ] && echo "WARNING: the last good backup is more than 36 hours old"
  else
    echo "No backup yet. Make one: sudo tadabbor-backup run"
  fi
  systemctl list-timers tadabbor-backup.timer --no-pager 2>/dev/null | head -n 2 || true
  ls -1 "$B/local" 2>/dev/null | grep '^tadabbor-' | sed 's/^/  on this server: /' || true
  ;;

list)
  for f in daily weekly monthly; do
    echo "== $f"
    rc lsf --files-only --format "sp" --separator "  " "$REMOTE/$f" 2>/dev/null | grep 'tadabbor-' | sort -r -k2 \
      | awk '{ if ($1 >= 1048576) printf "  %-36s %7.1f MB\n", $2, $1 / 1048576; else printf "  %-36s %7.0f KB\n", $2, $1 / 1024 }' || true
  done
  ;;

verify)
  D="$B/verify"
  rm -rf "$D"
  trap 'rm -rf "$D"' EXIT
  fetch_unpack "$D" "${1:-latest}"
  say "OK: this backup can be restored (nothing was changed on the server)"
  ;;

restore)
  [ "$(id -u)" = 0 ] || die "run as root: sudo tadabbor-backup restore ${1:-latest}"
  D="$B/restore"
  rm -rf "$D"
  fetch_unpack "$D" "${1:-latest}"
  echo
  echo "This replaces ALL live data of the app (users, sync, stats) with this backup."
  echo "Changes made after the backup are lost. The current data is kept in $BASE/pb_data.before-restore-*"
  if [ "${YES:-}" != 1 ]; then
    printf 'Type yes to continue: '
    read -r answer
    [ "$answer" = yes ] || { rm -rf "$D"; die "cancelled, nothing changed"; }
  fi
  TS=$(TZ=$TZNAME date +%Y%m%d-%H%M%S)
  OLD="$BASE/pb_data.before-restore-$TS"; n=1
  while [ -e "$OLD" ] || [ -e "$OLD.failed" ]; do OLD="$BASE/pb_data.before-restore-$TS-$n"; n=$((n + 1)); done
  say "stopping $SVC"
  systemctl stop $SVC
  mv "$PB_DATA" "$OLD"
  mv "$D/pb_data" "$PB_DATA"
  [ -d "$OLD/backups" ] && [ ! -e "$PB_DATA/backups" ] && mv "$OLD/backups" "$PB_DATA/backups"
  chown -R $TB:$TB "$PB_DATA" && chmod 700 "$PB_DATA"
  chmod 700 "$OLD"
  rm -rf "$D"
  systemctl start $SVC
  i=0
  until curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; do
    i=$((i + 1))
    if [ $i -ge 30 ]; then
      say "the server did not start with the restored data; putting the old data back"
      systemctl stop $SVC
      mv "$PB_DATA" "$OLD.failed" && mv "$OLD" "$PB_DATA"
      [ -d "$OLD.failed/backups" ] && [ ! -e "$PB_DATA/backups" ] && mv "$OLD.failed/backups" "$PB_DATA/backups"
      systemctl start $SVC
      die "restore failed, the server runs on its old data again. See: journalctl -u $SVC -n 50"
    fi
    sleep 1
  done
  say "OK: restored, $SVC is running on the backup's data"
  echo "The data from before the restore: $OLD"
  echo "When everything looks right, remove it: sudo rm -rf $OLD"
  ;;

*)
  echo "Usage: tadabbor-backup run | status | list | verify [NAME] | restore [NAME]"; exit 2 ;;
esac
