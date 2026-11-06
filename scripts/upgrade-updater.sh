#!/bin/bash
set -euo pipefail
# Run this trusted script on an already installed Raspberry Pi, before the next update.
[[ $EUID -eq 0 ]]
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$script_dir/pi-update.cjs" ]]
[[ -d /usr/local/lib/cov-monitor && -d /var/lib/cov-monitor/updates ]]
/usr/bin/node --check "$script_dir/pi-update.cjs"
systemctl stop cov-monitor-update.timer
trap 'systemctl start cov-monitor-update.timer' EXIT
if systemctl is-active --quiet cov-monitor-update.service; then
  echo 'Aktualizační služba právě pracuje. Počkejte na dokončení a spusťte příkaz znovu.' >&2
  exit 1
fi
[[ ! -e /opt/cov-monitor/transaction.json ]]
cp -n /usr/local/lib/cov-monitor/pi-update.cjs /usr/local/lib/cov-monitor/pi-update.cjs.before-rollback
install -o root -g root -m 644 "$script_dir/pi-update.cjs" /usr/local/lib/cov-monitor/pi-update.cjs.new
mv /usr/local/lib/cov-monitor/pi-update.cjs.new /usr/local/lib/cov-monitor/pi-update.cjs
/usr/bin/node /usr/local/lib/cov-monitor/pi-update.cjs --list-rollbacks
echo 'Aktualizační služba nyní podporuje ruční obnovu. Monitoring nebyl restartován.'
