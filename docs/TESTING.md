# Testing

```bash
npm test
npm run lint
```

Сейчас **10 файлов / ~28 тестов** (vitest). Покрытие растёт вместе с фичами; это не полный E2E UI.

| Файл | Что проверяет |
|------|----------------|
| `packages/application/src/auth.test.ts` | логин, неверный пароль, blocked |
| `packages/application/src/setup.test.ts` | создание организации и identity |
| `packages/permissions/src/rbac.test.ts` | ADMIN vs USER |
| `packages/crypto/src/envelope-signing.test.ts` | подпись / проверка envelope |
| `packages/messaging/src/chat-service.test.ts` | parse `dm_usr_…_usr_…`, unread / `markChatRead` |
| `packages/sync/src/messaging.test.ts` | доставка `chat.message`; Failed если нет устройства |
| `packages/sync/src/multi-device-sync.test.ts` | копия на второе устройство, `updated_at` у получателя, read receipt |
| `packages/sync/src/envelope-guard.test.ts` | подпись, replay nonce |
| `packages/file-transfer/src/file-transfer.test.ts` | хеш / нарезка |
| `packages/file-transfer/src/file-transfer-engine.test.ts` | e2e чанки, pause/resume, cancel, failed file без peer |

In-memory transport (`InMemoryTransport`) подменяет LAN daemon в unit-тестах.

План: WebRTC, полноценный E2E payload, UI e2e.
