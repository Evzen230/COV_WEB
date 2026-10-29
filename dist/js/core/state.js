// Server-owned records. Only theme preferences live in localStorage.
export let settings = {
  name: "Domovní ČOV",
  tempMin: 8,
  tempMax: 30,
  levelMax: 85,
  stale: 15,
  mode: "live",
  tankVolume: 2400,
};
export let history = [],
  labs = [],
  service = [],
  events = [],
  ack = {};
export let range = "24 h",
  metric = "temperature";
export let serverState = null,
  connected = false;
export const sensors = [
  {
    id: "temperature",
    name: "Teplota vody",
    device: "DS18B20 · 1-Wire",
    unit: "°C",
    base: 18.7,
    icon: "♧",
    min: 16,
    max: 22,
  },
  {
    id: "level",
    name: "Hladina nádrže",
    device: "Hladinová sonda · 4–20 mA",
    unit: "%",
    base: 64,
    icon: "▤",
    min: 45,
    max: 80,
  },
  {
    id: "ph",
    name: "pH vody",
    device: "pH sonda · analog",
    unit: "pH",
    base: 7.2,
    icon: "◉",
    min: 6.5,
    max: 8,
  },
  {
    id: "ec",
    name: "Vodivost",
    device: "EC sonda · analog",
    unit: "µS/cm",
    base: 842,
    icon: "ϟ",
    min: 700,
    max: 1000,
  },
  {
    id: "turbidity",
    name: "Zákal",
    device: "Optická sonda",
    unit: "NTU",
    base: 12.4,
    icon: "◈",
    min: 8,
    max: 20,
  },
  {
    id: "orp",
    name: "Redox potenciál",
    device: "ORP sonda · analog",
    unit: "mV",
    base: 185,
    icon: "⌁",
    min: 140,
    max: 220,
  },
];
export function setView(next) {
  if (next.range) range = next.range;
  if (next.metric) metric = next.metric;
}
export function setConnected(value) {
  connected = value;
}
export function applyState(s) {
  serverState = s;
  connected = true;
  settings = s.settings;
  history = s.history;
  labs = s.labs;
  service = s.service;
  events = s.events;
  ack = Object.fromEntries(s.alarms.map((a) => [a.id, !!a.acknowledged]));
}
