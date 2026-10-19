# MAC Campo — Publicar una versión (administrador)

Cómo compilar el APK firmado y dejarlo disponible para los usuarios. Referencias: `mobile/README.md`,
`.github/workflows/mobile-android.yml`, `docs/propuesta-offline-sync.md` §6.

## 1. Crear la llave de firma (solo una vez)

Android solo instala una actualización **encima** si está firmada con la **misma llave**. Si la llave se pierde, cada usuario
tendría que desinstalar (y perder lo no sincronizado).

1. En una computadora con Java:
   ```bash
   keytool -genkeypair -v -keystore ~/mac-campo-release.jks -alias mac-campo \
     -keyalg RSA -keysize 4096 -validity 10000
   ```
   Anota la contraseña del almacén y la de la llave.
2. Guarda `mac-campo-release.jks` y las contraseñas **fuera del repositorio**, con **2 respaldos** (p. ej. gestor de contraseñas + USB cifrada en resguardo).
3. Conviértela a texto: `base64 -w0 ~/mac-campo-release.jks`.
4. GitHub → *Settings → Secrets and variables → Actions*:
   - **Secrets**: `ANDROID_KEYSTORE_BASE64` (el texto del paso 3), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`mac-campo`), `ANDROID_KEY_PASSWORD`.
   - **Variables**: `MOBILE_API_URL` = `https://<tu dominio>`.

Si falta alguno de los 4 secretos, el workflow solo genera el APK *debug*.

## 2. Preparar el servidor (solo una vez)

- En `.env` de producción define `APP_DOWNLOAD_SECRET` (obligatoria). Genérala con `openssl rand -hex 32`.
- Los APK publicados se guardan en `releases/` (volumen de Docker). Inclúyelo en tus respaldos.

## 3. Subir la versión

1. Edita `mobile/package.json` → `"version"` (p. ej. `1.4.0` → `1.4.1`). Es la única fuente: `android/app/build.gradle` calcula `versionName` y `versionCode` (mayor·10000 + menor·100 + parche).
2. Usa versión **mayor** que la publicada; Android no instala una versión menor encima.
3. Commit y push a la rama correspondiente.

## 4. Compilar con firma

1. GitHub → **Actions** → **Mobile Android (MAC Campo)** → **Run workflow**.
2. Elige la rama. Deja `api_url` **vacío** para usar `MOBILE_API_URL` (debe ser HTTPS; el APK *release* no acepta HTTP).
3. Espera a que termine en verde.
4. En *Artifacts* descarga **`mac-campo-<versión>-release`** (no el `-debug`) y descomprime: dentro viene `app-release.apk`.

Un APK *debug* no actualiza a uno *release* ni al revés. A usuarios reales entrega siempre el `-release`.

## 5. Publicar en la web

1. Web → **Sincronización** → **«Versiones de la app»**.
2. Llena:
   - **Archivo APK**: `app-release.apk`.
   - **Versión**: la de `mobile/package.json` (p. ej. `1.4.1`).
   - **Versión mínima**: ver sección 6.
   - **Notas**: qué cambió, en lenguaje simple.
   - **Enlace iOS**: vacío por ahora.
3. Guarda. Desde ese momento:
   - **«App móvil MAC Campo»** (`/app`) ofrece la nueva versión en **«Descargar APK»**.
   - En la siguiente sincronización la app muestra **«Nueva versión X disponible · Actualizar»**.

## 6. Cuándo subir la versión mínima

- **Normalmente no**: deja la mínima igual; los usuarios actualizan cuando puedan.
- **Súbela** a la nueva versión solo si:
  - cambió el protocolo de sincronización o los datos que envía el teléfono;
  - la versión vieja tiene un error que genera datos incorrectos o rechazos;
  - hay un problema de seguridad.
- Con la mínima arriba, las apps más viejas muestran **«Actualización obligatoria»**: primero envían sus pendientes y después piden instalar. No se pierde lo capturado.
- Avisa a los usuarios antes (WhatsApp) y súbela de preferencia al inicio del día.
- Cambios solo en el servidor (precios, permisos, validaciones) **no** requieren nueva versión de la app.

## 7. Verificar

1. Instala la nueva versión **encima** en un teléfono de prueba: debe conservar datos y pendientes.
2. **Más → Aplicación → Versión** muestra la nueva.
3. Web → **Sincronización** → dispositivos:
   - **«Desactualizada»**: el teléfono sigue con una versión anterior.
   - **«Sin sincronizar hace N h»**: el teléfono no se conecta desde hace tiempo; contacta al usuario.
4. Revisa en los siguientes días que todos los dispositivos pasen a la nueva versión.

## 8. iOS (pendiente — fase 5 bis)

Apple no permite instalar archivos sueltos. Requisitos:
- Cuenta **Apple Developer** (USD 99/año) y compilar en **macOS** (Mac propia o runner macOS de GitHub Actions).
- **Ad Hoc** (recomendado): registrar los UDID de los iPhone e instalar desde un enlace del hosting; el certificado se renueva cada año.
- **TestFlight** (alternativa): invitación por correo; cada build caduca a los 90 días.
- En iOS el aviso de actualización solo abre el enlace (campo **Enlace iOS** en «Versiones de la app»).
