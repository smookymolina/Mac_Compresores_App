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
`../public/icons`, requiere `npm install` en la raíz por `sharp`).

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

## iOS (proyecto nativo versionado en `ios/`)

Generado con `npx cap add ios` (Capacitor 8 usa **Swift Package Manager**, sin CocoaPods: `ios/App/CapApp-SPM/Package.swift`
lo reescribe `cap sync`). Abrir `ios/App/App.xcodeproj` (no hay `.xcworkspace`). Config: bundle `mx.com.maccompresores.campo`,
nombre «MAC Campo», iOS ≥ 15.0 (mínimo de Capacitor 8), iPhone + iPad.
- Versión: `node scripts/ios-version.mjs` copia `package.json` → `MARKETING_VERSION` (`1.4.0`) y `CURRENT_PROJECT_VERSION`
  (`10400`, o `IOS_BUILD_NUMBER`). CI lo ejecuta antes de compilar; correrlo y versionar el cambio al subir versión.
- `Info.plist`: `NSFaceIDUsageDescription` (español); ATS solo HTTPS (`NSAllowsArbitraryLoads=false`) +
  `NSAllowsLocalNetworking=true` (http a IPs de la LAN/`*.local` para probar con Docker; no relaja dominios públicos.
  ATS no es configurable por build en Capacitor: si se quiere quitar en producción, borrar esa llave).
  `ITSAppUsesNonExemptEncryption` no se declara: App Store Connect lo pregunta al subir (SQLCipher → revisar exención).
- BD: `iosDatabaseLocation: "Library/CapacitorDatabase"` → el plugin excluye la carpeta del respaldo de iCloud. Llave
  SQLCipher, token y PIN en Keychain (plugins).
- Ícono: `node scripts/ios-icons.mjs` (1024×1024 opaco desde `icon-maskable-512.png`).

### Requisitos
- **Mac con Xcode** (16+) para compilar/firmar; en Linux solo se edita el proyecto. Alternativa: el workflow en `macos-latest`.
- **Apple Developer Program** (USD 99/año) para instalar fuera del simulador: certificado **Apple Distribution** (.p12) y
  perfil de aprovisionamiento del App ID `mx.com.maccompresores.campo`.
  - *Ad Hoc*: registrar el **UDID** de cada iPhone/iPad (Mac: Finder → dispositivo → clic bajo el nombre hasta ver el UDID) en *Certificates, IDs & Profiles → Devices* (máx. 100/año por tipo), luego regenerar el perfil
    Ad Hoc incluyéndolos y actualizar el secreto. Un teléfono no registrado no puede instalar el IPA.
  - *App Store*: perfil «App Store Connect» + app creada en App Store Connect; distribución por **TestFlight** (sin UDIDs,
    hasta 10 000 testers; builds caducan a 90 días). Es la alternativa recomendada si no se quiere gestionar UDIDs.

### Secretos (GitHub → Settings → Secrets and variables → Actions)
| Secreto | Contenido |
|---|---|
| `IOS_CERT_P12_BASE64` | `base64 -i dist.p12` (certificado Apple Distribution + llave privada, exportado del Llavero) |
| `IOS_CERT_PASSWORD` | contraseña del .p12 |
| `IOS_PROVISION_PROFILE_BASE64` | `base64 -i MAC_Campo_AdHoc.mobileprovision` (Ad Hoc **o** App Store, según el método) |
| `IOS_TEAM_ID` | Team ID (10 caracteres, *Membership*) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` | opcional, TestFlight: llave API de App Store Connect (*Users and Access → Integrations*, rol App Manager) |

### Workflow «Mobile iOS (MAC Campo)» (manual)
*Actions → Run workflow* con `api_url` (vacío = variable `MOBILE_API_URL`), `export_method` (`ad-hoc` | `app-store`) y
opcional `build_number`. Siempre: tests, build web, `cap sync ios` y build de **simulador sin firma** (valida que compila).
Con los 4 secretos `IOS_*`: archive firmado (llavero temporal, borrado al final) → artefacto
`mac-campo-<versión>-ios-<método>` (.ipa). Con `app-store` + secretos `ASC_*`: se sube a TestFlight (`xcrun altool`).
El perfil subido debe coincidir con el método elegido.

### Instalar / actualizar
- *Ad Hoc (OTA)*: el administrador publica el IPA en el ERP; la app pide `POST /api/sync/app-download {platform:"ios"}` →
  `itms-services://…` y iOS ofrece instalar encima (mismo bundle → se conservan los datos). Primera instalación: abrir el
  enlace en Safari del teléfono o Apple Configurator/Finder con el IPA. Si no hay IPA publicado (404) se abre `iosUrl`
  (p. ej. enlace público de TestFlight). En iOS la versión se compara contra `ios.latest` de `/api/app/version`.
- *TestFlight*: invitar testers en App Store Connect; ellos instalan con la app TestFlight.

### En un Mac (local)
```bash
cd mobile && npm ci && VITE_API_URL=https://<erp> npm run build
npx cap sync ios && node scripts/ios-version.mjs
npx cap open ios     # Xcode → Signing & Capabilities: elegir Team → Run en simulador o dispositivo
```

## Notas comunes

- SQLCipher: `@capacitor-community/sqlite` con `androidIsEncryption/iosIsEncryption` (capacitor.config.ts). La llave se genera
  al primer arranque y la guarda el plugin (`setEncryptionSecret`, Keystore/Keychain).
- La URL del servidor se fija al compilar con `VITE_API_URL`; no va en `capacitor.config.ts`.

## Núcleo (`src/core`)

`createApp()` → `AppController` (`start`, `syncNow`, `login`, `setPin`, `unlock`, `unlockBiometric`, `lock`, `logout`);
en React: `<AppProvider controller>` + `useApp()`. Piezas sueltas: `createApiClient`, `LocalStore`
(`MemoryStore`/`SqliteStore`), `SyncEngine`, `Session`, `canCapture`.
