# Protocol

Все сетевые сообщения — JSON envelope (`PROTOCOL_VERSION = 1`):

```json
{
  "protocolVersion": 1,
  "messageType": "chat.message",
  "messageId": "msg_...",
  "senderDeviceId": "dev_...",
  "timestamp": "2026-09-28T08:00:00.000Z",
  "nonce": "...",
  "payload": {},
  "signature": "..."
}
```

Тип `MessageType` — `@lockal/shared`. Подпись: Ed25519 по каноническому телу `{ messageType, messageId, senderDeviceId, timestamp, nonce, payload }`. `EnvelopeGuard` отвергает неверную подпись и **повтор той же пары sender+nonce** (`seen_envelopes`, хранение ~7 дней).

## Используемые типы

| messageType | Назначение |
|-------------|------------|
| `chat.message` | текст; payload: messageId, chatId, senderUserId, content, clientNonce, sentAt |
| `chat.ack` | статус `delivered` или `read` |
| `presence.update` | online/offline и метка времени |
| `file.meta` / `file.chunk` / `file.complete` / `file.resume` | передача файла |
| `sync.envelope` | в т.ч. `directory.snapshot` (пользователи и устройства организации) |

Зарезервированы, UI пока не шлёт: `chat.reaction`, `device.hello`, `device.trust`, `admin.signed`, `call.signal`.

## Сообщения

- Идемпотентность: `UNIQUE(chat_id, client_nonce)`
- Исходящие без живого peer кладутся в `message_outbox` и ретраятся; после лимита попыток статус **Failed**, в UI можно повторить
- Открытие чата: `chat_members.last_read_at` + `chat.ack` `read` отправителю (и его другим устройствам)

## Файлы

Метаданные и чанки — отдельные envelopes. Локальный blob в IndexedDB. Неуспешная первая отправка оставляет сообщение в чате со статусом failed и кнопкой «Повторить».

## Каталог

Admin-устройство рассылает snapshot пользователей/устройств, чтобы Join и Contacts на других ПК видели тех же людей без центрального сервера.
