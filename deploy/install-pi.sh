#!/bin/bash
set -euo pipefail
# Run from the project root on Raspberry Pi OS (64 bit), with Node 24.13+ installed.
if [[ $EUID -ne 0 || $# -ne 2 ]]; then
  echo 'Použití: sudo bash deploy/install-pi.sh /cesta/update-public.pem https://github.com/OWNER/REPO/releases/latest/download/manifest.json' >&2
  exit 1
fi
[[ -f server.cjs && -f "$1" && "$2" == https://* && "$2" != *$'\n'* && "$2" != *$'\r'* ]]
/usr/bin/node -e 'const v=process.versions.node.split(".").map(Number);if(v[0]!==24||v[1]<13)process.exit(1)'
[[ ! -e /opt/cov-monitor/current && ! -L /opt/cov-monitor/current ]]
id cov-monitor >/dev/null 2>&1 || useradd --system --home-dir /var/lib/cov-monitor --shell /usr/sbin/nologin cov-monitor
install -d -m 755 /opt/cov-monitor/releases /etc/cov-monitor /usr/local/lib/cov-monitor /var/lib/cov-monitor
install -d -m 700 /opt/cov-monitor/backups
install -d -o cov-monitor -g cov-monitor -m 700 /var/lib/cov-monitor/data /var/lib/cov-monitor/updates
release="/opt/cov-monitor/releases/initial-$(date +%s)"
install -d -m 755 "$release"
cp -R server.cjs package.json README.md dist server scripts docs "$release/"
chown -R root:root "$release"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
ln -s "$release" /opt/cov-monitor/current
install -m 644 "$1" /etc/cov-monitor/update-public.pem
install -m 644 scripts/pi-update.cjs /usr/local/lib/cov-monitor/pi-update.cjs
install -m 644 deploy/server.env.example /etc/cov-monitor/server.env
printf '\nUPDATE_MANIFEST_URL=%s\n' "$2" >> /etc/cov-monitor/server.env
install -m 644 deploy/cov-monitor.service deploy/cov-monitor-update.service deploy/cov-monitor-update.timer /etc/systemd/system/
runuser -u cov-monitor -- env AUTH_FILE=/var/lib/cov-monitor/data/auth.json /usr/bin/node "$release/scripts/setup.cjs"
systemctl daemon-reload
systemctl enable --now cov-monitor.service cov-monitor-update.timer
echo 'Instalace dokončena. Otevřete http://IP-MALINY:4173.'
