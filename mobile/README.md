# MAC Campo (app móvil, Capacitor 8)

SPA React 19 + Vite + Tailwind 4. Reglas compartidas desde `../src/domain` (alias `@domain`).
Ver `../docs/propuesta-offline-sync.md`.

```bash
cd mobile && npm install
VITE_API_URL=http://localhost:3080 npm run dev   # navegador: MemoryStore, sin cifrado
npm run typecheck && npm test && npm run build
```

## Android (proyecto nativo versionado en `android/`)

Config: `minSdk 24`, `applicationId mx.com.maccompresores.campo`, versión `1.4.0` / `10400` (`android/app/build.gradle` las calcula de
`mobile/package.json`: solo se sube la versión ahí). HTTP en claro **solo en debug** (`app/src/debug/res/xml/network_security_config.xml`);
release solo HTTPS. `allowBackup=false` + `data_extraction_rules.xml`: la BD local no se respalda en la nube.
Permisos: INTERNET, ACCESS_NETWORK_STATE, USE_BIOMETRIC. Íconos: `node scripts/android-icons.mjs` (desde
`../public/icons`, requiere `npm install` en la raíz por `sharp`). iOS: fase posterior (`mobile/ios` sigue ignorado).

### Obtener el APK desde GitHub Actions
1. Una vez: *Settings → Secrets and variables → Actions → Variables* → `MOBILE_API_URL` = `https://<erp>`.
2. *Actions → «Mobile Android (MAC Campo)» → Run workflow* (opcional `api_url`), o push a `v1.4.0` que toque
   `mobile/**` o `src/domain/**`.
3. Al terminar, en *Artifacts*: `mac-campo-<versión>-debug` (y `-release` si hay firma). Descomprimir el `.zip`.

### Firma de release (opcional)
```bash
keytool -genkeypair -v -keystore ~/mac-campo-release.jks -alias mac-campo \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 ~/mac-campo-release.jks   # → secreto ANDROID_KEYSTORE_BASE64
```
Secretos: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Guardar el `.jks` **fuera del repo** y en **dos respaldos** (p. ej. gestor de contraseñas + USB en resguardo): si se
pierde, las instalaciones existentes no podrán actualizarse (habrá que desinstalar y perder datos locales sin sincronizar).
Localmente: `ANDROID_KEYSTORE_PATH=~/mac-campo-release.jks ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=… ./gradlew assembleRelease`.

### Instalar en el teléfono
Copiar el `.apk` al teléfono (USB, Drive, correo) → abrirlo → al aviso, *Ajustes → Permitir de esta fuente*
(«Instalar apps desconocidas») → Instalar. Para actualizar, instalar encima un APK firmado con la **misma** llave
(un debug no actualiza a un release ni viceversa). Con USB: `adb install -r app-debug.apk`.

### Compilar localmente (Android Studio)
```bash
VITE_API_URL=https://<erp> npm run build   # http://<ip-lan>:3080 solo funciona en debug
npx cap sync android
npx cap open android                       # Android Studio (JDK 21, SDK 36) → Run / Build APK
# o sin IDE: cd android && ./gradlew assembleDebug  → app/build/outputs/apk/debug/app-debug.apk
```

- SQLCipher: `@capacitor-community/sqlite` con `androidIsEncryption/iosIsEncryption` (capacitor.config.ts). La llave se genera
  al primer arranque y la guarda el plugin (`setEncryptionSecret`, Keystore/Keychain).
- La URL del servidor se fija al compilar con `VITE_API_URL`; no va en `capacitor.config.ts`.

## Núcleo (`src/core`)

`createApp()` → `AppController` (`start`, `syncNow`, `login`, `setPin`, `unlock`, `unlockBiometric`, `lock`, `logout`);
en React: `<AppProvider controller>` + `useApp()`. Piezas sueltas: `createApiClient`, `LocalStore`
(`MemoryStore`/`SqliteStore`), `SyncEngine`, `Session`, `canCapture`.
