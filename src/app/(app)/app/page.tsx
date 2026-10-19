import { redirect } from "next/navigation";
import { Download, ExternalLink, Smartphone } from "lucide-react";
import { homePath, requireUser } from "@/lib/auth/session";
import { DOWNLOAD_PATH, userHasMobileAccess } from "@/modules/sync/app-download";
import { mobileAppVersion } from "@/modules/sync/version";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "App móvil MAC Campo" };
export const dynamic = "force-dynamic";

export default async function MobileAppPage() {
  const user = await requireUser();
  if (!(await userHasMobileAccess(user.id))) redirect(`${homePath(user)}?denied=1`);
  const app = await mobileAppVersion();
  const size = app.size != null ? `${(app.size / (1024 * 1024)).toLocaleString("es-MX", { maximumFractionDigits: 1 })} MB` : null;

  return (
    <>
      <PageHeader title="App móvil MAC Campo" subtitle="Captura cotizaciones y clientes sin internet; se sincroniza al recuperar la señal."
        meta={app.publishedAt ? [{ label: "Versión", value: app.latest }, { label: "Publicada", value: fmtDateTime(new Date(app.publishedAt)) }] : undefined} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Android" description={size ? `APK ${app.latest} · ${size}` : undefined} />
          {app.publishedAt ? (
            <div className="space-y-3 p-4">
              {/* Enlace normal (no <Link>): descarga de archivo con la sesión web. */}
              <a href={DOWNLOAD_PATH} className="btn btn-primary w-full gap-2 sm:w-auto" download>
                <Download size={16} aria-hidden /> Descargar APK
              </a>
              {app.notes && (
                <div>
                  <h3 className="text-xs font-medium text-muted">Novedades</h3>
                  <p className="whitespace-pre-line break-words text-sm">{app.notes}</p>
                </div>
              )}
              {app.sha256 && <p className="break-all text-xs text-muted">SHA-256: <span className="mono">{app.sha256}</span></p>}
            </div>
          ) : (
            <EmptyState icon={Smartphone} title="Aún no hay versión publicada">El administrador publicará el APK en Sincronización.</EmptyState>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Cómo instalar" />
          <ol className="list-decimal space-y-2 p-4 pl-8 text-sm">
            <li>Abre esta página en tu teléfono Android y toca «Descargar APK».</li>
            <li>Abre el archivo descargado. Si Android lo pide, activa <b>«Permitir de esta fuente»</b> (instalar apps desconocidas) para tu navegador; solo se hace una vez.</li>
            <li>Si Google Play Protect muestra «App no reconocida», toca <b>«Más detalles» → «Instalar de todas formas»</b>. Es normal en apps privadas que no vienen de la tienda.</li>
            <li>Abre MAC Campo, entra con tu correo y contraseña de siempre y crea tu PIN.</li>
            <li>Las siguientes versiones se instalan desde la propia app al sincronizar; tus datos y pendientes se conservan.</li>
          </ol>
          {app.iosUrl && (
            <div className="border-t border-line p-4">
              <a href={app.iosUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full gap-2 sm:w-auto">
                <ExternalLink size={16} aria-hidden /> Instalar en iPhone / iPad
              </a>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
