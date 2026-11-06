#!/bin/bash
set -euo pipefail
# Idempotent additional installation for existing Pi deployments.
[[ $EUID -eq 0 ]] || { echo 'Spusťte jako root.' >&2; exit 1; }
[[ -f scripts/network-service.cjs && -f scripts/cov-network.service ]]
[[ -f /etc/os-release ]] || exit 1
. /etc/os-release
[[ ${VERSION_CODENAME:-} == bookworm || ${VERSION_CODENAME:-} == trixie ]] || { echo 'Podporován Raspberry Pi OS Bookworm/Trixie s NetworkManagerem; síť nebyla změněna.' >&2; exit 1; }
grep -aq 'Raspberry Pi 4' /proc/device-tree/model || { echo 'Očekáváno Raspberry Pi 4.' >&2; exit 1; }
systemctl is-active --quiet NetworkManager || { echo 'NetworkManager neběží; síť nebyla změněna.' >&2; exit 1; }
[[ $(nmcli -g GENERAL.TYPE device show wlan0) == wifi ]]
id cov-monitor >/dev/null
install -d -m 755 /etc/cov-monitor /usr/local/lib/cov-monitor
/usr/bin/node <<'NODE'
const fs=require('node:fs'),{randomUUID,randomBytes}=require('node:crypto');
const filename='/etc/cov-monitor/network.json';
const config=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{apUuid:randomUUID(),ssid:'COV-Pi-Setup-'+randomBytes(3).toString('hex'),password:randomBytes(12).toString('hex')};
if(!fs.existsSync(filename))fs.writeFileSync(filename,JSON.stringify(config),{mode:0o600});
fs.writeFileSync('/etc/NetworkManager/system-connections/cov-setup.nmconnection',`[connection]\nid=COV setup\nuuid=${config.apUuid}\ntype=wifi\ninterface-name=wlan0\nautoconnect=false\n\n[wifi]\nmode=ap\nssid=${config.ssid}\nband=bg\n\n[wifi-security]\nkey-mgmt=wpa-psk\npsk=${config.password}\n\n[ipv4]\nmethod=shared\naddress1=192.168.4.1/24\n\n[ipv6]\nmethod=disabled\n`,{mode:0o600});
NODE
nmcli connection load /etc/NetworkManager/system-connections/cov-setup.nmconnection
install -m 644 scripts/network-service.cjs /usr/local/lib/cov-monitor/network-service.cjs
install -m 644 scripts/cov-network.service /etc/systemd/system/cov-network.service
systemctl daemon-reload
systemctl enable --now cov-network.service
systemctl restart cov-network.service
/usr/bin/node <<'NODE'
const c=JSON.parse(require('node:fs').readFileSync('/etc/cov-monitor/network.json','utf8'));
console.log(`Údaje pro štítek maliny:\nWi-Fi: ${c.ssid}\nHeslo: ${c.password}\nNastavení: http://192.168.4.1:8080`);
NODE
