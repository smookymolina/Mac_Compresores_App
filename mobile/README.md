# MAC Campo (app móvil, Capacitor 8)

SPA React 19 + Vite + Tailwind 4. Reglas compartidas desde `../src/domain` (alias `@domain`).
Ver `../docs/propuesta-offline-sync.md`.

```bash
cd mobile && npm install
VITE_API_URL=http://localhost:3080 npm run dev   # navegador: MemoryStore, sin cifrado
npm run typecheck && npm test && npm run build
```

## Nativo (requiere Android SDK / Xcode; no se generan en CI)

```bash
VITE_API_URL=https://<erp> npm run build
npx cap add android      # una vez; commitear android/
npx cap add ios          # una vez, en macOS
npx cap sync
npx cap open android
```

- SQLCipher: `@capacitor-community/sqlite` con `androidIsEncryption/iosIsEncryption` (capacitor.config.ts). La llave se genera
  al primer arranque y la guarda el plugin (`setEncryptionSecret`, Keystore/Keychain).
- Android: `minSdkVersion` ≥ 24 y, para HTTP en pruebas locales, `android:usesCleartextTraffic` solo en debug.
- La URL del servidor se fija al compilar con `VITE_API_URL`; no va en `capacitor.config.ts`.

## Núcleo (`src/core`)

`createApp()` → `AppController` (`start`, `syncNow`, `login`, `setPin`, `unlock`, `unlockBiometric`, `lock`, `logout`);
en React: `<AppProvider controller>` + `useApp()`. Piezas sueltas: `createApiClient`, `LocalStore`
(`MemoryStore`/`SqliteStore`), `SyncEngine`, `Session`, `canCapture`.
