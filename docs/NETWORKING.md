# Networking

## Принципы

- Каждое устройство — **peer**, без обязательного central server.
- Discovery: **mDNS** + UDP broadcast fallback.
- После обнаружения — обмен только с устройствами организации (подписи envelopes, known peers). Auto-trust чужих ключей нет.

## NetworkTransport

См. `packages/networking`. Реализация для desktop: `DaemonLanTransport` → WebSocket на `lockal-daemon` (по умолчанию `ws://127.0.0.1:39201`).

| Transport | Статус |
|-----------|--------|
| LAN (`lockal-daemon` + WS) | работает |
| Wifi Direct / Bluetooth | план |
| Internet / relay | план |

Типичные порты (можно сменить в Настройках и перелогиниться):

| Порт | Роль |
|------|------|
| 39200 | LAN (discovery / P2P TCP) |
| 39201 | WebSocket UI ↔ daemon |

Два клиента на одной машине — **разные** пары портов.

## Жизненный цикл daemon

- Dev (`npm start`): процесс поднимается при входе.
- Tauri: sidecar после логина или из сохранённого config; при закрытии окна **kill** — процесс не должен оставаться в фоне.
- LockalChat не создаёт VPN, TUN и не подменяет default route. Если «пропал интернет и пишет VPN» — смотрите сторонние клиенты на машине, не этот процесс.

## WebRTC (план)

Сигналинг тем же P2P-каналом; STUN/TURN — только если появится remote mode.
