import { CheckCircle2, Smartphone } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listDevices, listSyncIssues } from "@/modules/sync/admin";
import {
  rejectSyncConflictAction, resolvePriceConflictAction, resolveSyncIssueAction, retrySyncConflictAction, revokeDeviceAction,
} from "@/modules/sync/actions";
import type { ConflictResult, PriceConflictResult, StockConflictResult } from "@/modules/sync/protocol";
import { listWarehouses } from "@/modules/inventory/service";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader, SelectField, type DataColumn } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { fmtMoney } from "@/lib/money";
import { mobileAppVersion } from "@/modules/sync/version";
import { compareVersions } from "@/modules/sync/semver";
import { IosReleaseForm, ReleaseForm } from "./release-form";

export const metadata = { title: "Sincronización" };

const fmtSize = (n: number) => `${(n / (1024 * 1024)).toLocaleString("es-MX", { maximumFractionDigits: 1 })} MB`;
const STALE_MS = 24 * 3_600_000;

const PLATFORM: Record<string, string> = { ANDROID: "Android", IOS: "iOS" };
const ISSUE_STATUS: Record<string, string> = { REJECTED: "Rechazado", CONFLICT: "Conflicto" };

const DEVICE_COLUMNS: DataColumn[] = [
  { id: "user", header: "Usuario", sortable: true, cellClass: "min-w-32" },
  { id: "name", header: "Nombre", sortable: true },
  { id: "platform", header: "Plataforma", sortable: true },
  { id: "version", header: "Versión", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "seen", header: "Última conexión", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "status", header: "Estado", sortable: true },
  { id: "actions", header: "Acciones" },
];

const ISSUE_COLUMNS: DataColumn[] = [
  { id: "captured", header: "Fecha captura", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "user", header: "Usuario", sortable: true, cellClass: "min-w-32" },
  { id: "type", header: "Tipo", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "status", header: "Estado", sortable: true },
  { id: "error", header: "Motivo", cellClass: "min-w-40 break-words" },
  { id: "actions", header: "Acciones" },
];

function PriceDiff({ c }: { c: PriceConflictResult }) {
  return (
    <div className="mt-2 grid gap-1 text-xs">
      {c.items.length > 0 && (
        <table className="w-full text-left">
          <thead><tr className="text-muted"><th className="pr-2 font-medium">SKU</th><th className="pr-2 text-right font-medium">Teléfono</th><th className="text-right font-medium">Actual</th></tr></thead>
          <tbody>
            {c.items.map((it, n) => (
              <tr key={`${it.productId}-${n}`}>
                <td className="mono pr-2">{it.sku}</td>
                <td className="pr-2 text-right tabular-nums">{fmtMoney(it.clientPrice)}</td>
                <td className="text-right tabular-nums">{fmtMoney(it.serverPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.exchangeRate && <p>Tipo de cambio: teléfono <span className="mono">{c.exchangeRate.client ?? "—"}</span> · actual <span className="mono">{c.exchangeRate.server ?? "—"}</span></p>}
    </div>
  );
}

const fmtQty = (s: string) => Number(s).toLocaleString("es-MX", { maximumFractionDigits: 3 });

function StockDiff({ c, warehouse }: { c: StockConflictResult; warehouse: string | null }) {
  return (
    <div className="mt-2 grid gap-1 text-xs">
      <p>Almacén: <span className="font-medium">{warehouse ?? "—"}</span></p>
      <table className="w-full text-left">
        <thead><tr className="text-muted"><th className="pr-2 font-medium">SKU</th><th className="pr-2 text-right font-medium">Pedido</th><th className="text-right font-medium">Disponible</th></tr></thead>
        <tbody>
          {c.items.map((it) => (
            <tr key={it.productId}>
              <td className="mono pr-2">{it.sku}</td>
              <td className="pr-2 text-right tabular-nums">{fmtQty(it.requested)}</td>
              <td className="text-right tabular-nums">{fmtQty(it.available)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConflictDetail({ c, warehouse }: { c: ConflictResult; warehouse: string | null }) {
  if (c.kind === "price") return <PriceDiff c={c} />;
  if (c.kind === "stock") return <StockDiff c={c} warehouse={warehouse} />;
  return (
    <p className="mt-2 text-xs">
      RFC <span className="mono">{c.rfc}</span> ya está registrado en otro cliente. Al rechazar, el vendedor recibe el aviso para usar el cliente existente.
    </p>
  );
}

export default async function SyncPage() {
  const actor = await requirePagePermission("users.manage");
  const canOverride = can(actor, "quotes.override_price");
  const [devices, issues, warehouses, app] = await Promise.all([
    listDevices(), listSyncIssues({ take: 100 }),
    listWarehouses().then((ws) => ws.filter((w) => w.active)),
    mobileAppVersion(),
  ]);
  const now = Date.now();
  const active = devices.filter((d) => !d.revokedAt).length;

  return (
    <>
      <PageHeader title="Sincronización" subtitle="Teléfonos con la app móvil y operaciones que el servidor no pudo aplicar." />
      <div className="grid grid-cols-1 gap-4">
        <Card className="overflow-hidden">
          <CardHeader title="Versiones de la app" description="Publica el APK de Android. Los teléfonos lo descargan desde aquí al sincronizar; se conservan las últimas 3 versiones." />
          {app.publishedAt ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-4 py-3 text-sm sm:grid-cols-5">
              <div><dt className="text-xs text-muted">Publicada</dt><dd className="mono">{app.latest}</dd></div>
              <div><dt className="text-xs text-muted">Mínima</dt><dd className="mono">{app.minimum}</dd></div>
              <div><dt className="text-xs text-muted">Fecha</dt><dd>{fmtDateTime(new Date(app.publishedAt))}</dd></div>
              <div><dt className="text-xs text-muted">Tamaño</dt><dd>{app.size != null ? fmtSize(app.size) : "—"}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted">SHA-256</dt><dd className="mono truncate" title={app.sha256 ?? undefined}>{app.sha256 ? `${app.sha256.slice(0, 12)}…` : "—"}</dd></div>
              {app.notes && <div className="col-span-2 sm:col-span-5"><dt className="text-xs text-muted">Notas</dt><dd className="whitespace-pre-line break-words">{app.notes}</dd></div>}
            </dl>
          ) : (
            <p className="border-b border-line px-4 py-3 text-sm text-muted">Aún no se ha publicado ningún APK.</p>
          )}
          <ReleaseForm latest={app.latest} minimum={app.minimum} iosUrl={app.ios ? "" : app.iosUrl ?? ""} iosAdHoc={!!app.ios} />
          <section aria-labelledby="ios-adhoc" className="border-t border-line">
            <div className="px-4 pt-4">
              <h3 id="ios-adhoc" className="text-sm font-semibold">iOS (Ad Hoc)</h3>
              <p className="text-xs text-muted">Se instala desde la página /app (enlace itms-services). Solo en iPhones cuyo UDID esté registrado en el perfil Ad Hoc; se conservan las últimas 3 versiones.</p>
            </div>
            {app.ios ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line px-4 py-3 text-sm sm:grid-cols-5">
                <div><dt className="text-xs text-muted">Publicada</dt><dd className="mono">{app.ios.latest}</dd></div>
                <div><dt className="text-xs text-muted">Bundle ID</dt><dd className="mono break-all">{app.ios.bundleId}</dd></div>
                <div><dt className="text-xs text-muted">Fecha</dt><dd>{fmtDateTime(new Date(app.ios.publishedAt))}</dd></div>
                <div><dt className="text-xs text-muted">Tamaño</dt><dd>{fmtSize(app.ios.size)}</dd></div>
                <div className="min-w-0"><dt className="text-xs text-muted">SHA-256</dt><dd className="mono truncate" title={app.ios.sha256}>{`${app.ios.sha256.slice(0, 12)}…`}</dd></div>
              </dl>
            ) : (
              <p className="mt-3 border-y border-line px-4 py-3 text-sm text-muted">Aún no se ha publicado ningún IPA.</p>
            )}
            <IosReleaseForm latest={app.ios?.latest ?? app.latest} />
          </section>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Dispositivos" description={`${active} activos de ${devices.length} registrados. Revocar cierra la sesión del teléfono.`} />
          <DataTable mobileCards
            caption="Dispositivos registrados"
            columns={DEVICE_COLUMNS}
            empty={<EmptyState icon={Smartphone} title="Sin dispositivos">Aparecerán aquí cuando un usuario con acceso a la app móvil inicie sesión en su teléfono.</EmptyState>}
            rows={devices.map((d) => ({
              id: d.id,
              cells: [
                d.user.name, <span key="n" className="break-words">{d.name}</span>, PLATFORM[d.platform] ?? d.platform,
                <span key="v" className="mono">{d.appVersion}</span>,
                d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : "Nunca",
                d.revokedAt ? <Badge key="s" tone="red">Revocado</Badge> : (
                  <div key="s" className="flex flex-wrap gap-1">
                    <Badge tone="green">Activo</Badge>
                    {compareVersions(d.appVersion, app.minimum) < 0 && <Badge tone="amber">Desactualizada</Badge>}
                    {d.lastSeenAt && now - d.lastSeenAt.getTime() > STALE_MS && (
                      <Badge tone="amber">Sin sincronizar hace {Math.floor((now - d.lastSeenAt.getTime()) / 3_600_000)} h</Badge>
                    )}
                  </div>
                ),
                d.revokedAt ? "" : (
                  <ActionForm key="r" action={revokeDeviceAction.bind(null, d.id)} submitLabel="Revocar" variant="danger" size="sm"
                    confirmText={`Confirmo revocar «${d.name}»`} />
                ),
              ],
              sort: [d.user.name, d.name, PLATFORM[d.platform] ?? d.platform, d.appVersion, d.lastSeenAt?.getTime() ?? null, d.revokedAt ? 1 : 0, null],
            }))}
          />
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Incidencias de sincronización" description="Operaciones rechazadas o en conflicto pendientes de revisar (máximo 100)." />
          <DataTable mobileCards
            caption="Incidencias de sincronización"
            columns={ISSUE_COLUMNS}
            empty={<EmptyState icon={CheckCircle2} title="Sin incidencias">Todas las operaciones recibidas de los teléfonos se aplicaron o ya fueron revisadas.</EmptyState>}
            rows={issues.map((i) => ({
              id: i.id,
              cells: [
                fmtDateTime(i.capturedAt), i.userName ?? "—",
                <span key="t" className="mono text-xs">{i.type}</span>,
                <Badge key="s" tone={i.status === "CONFLICT" ? "amber" : "red"}>{ISSUE_STATUS[i.status] ?? i.status}</Badge>,
                <div key="e">
                  {i.error ?? "—"}
                  {i.conflict && <ConflictDetail c={i.conflict} warehouse={i.warehouseName} />}
                  {i.conflict && i.device.revokedAt && <p className="mt-2 text-xs text-danger">Dispositivo revocado: solo se puede rechazar.</p>}
                </div>,
                <IssueActions key="r" i={i} warehouses={warehouses} canOverride={canOverride} />,
              ],
              sort: [i.capturedAt.getTime(), i.userName, i.type, ISSUE_STATUS[i.status] ?? i.status, null, null],
            }))}
          />
        </Card>
      </div>
    </>
  );
}

type Issue = Awaited<ReturnType<typeof listSyncIssues>>[number];

function IssueActions({ i, warehouses, canOverride }: { i: Issue; warehouses: { id: string; code: string; name: string }[]; canOverride: boolean }) {
  if (!i.conflict) {
    return i.status === "CONFLICT" ? (
      <div className="flex flex-wrap gap-2">
        {!i.device.revokedAt && <ActionForm action={retrySyncConflictAction.bind(null, i.id)} submitLabel="Reintentar" size="sm" />}
        <ActionForm action={resolveSyncIssueAction.bind(null, i.id)} submitLabel="Marcar como revisada" variant="secondary" size="sm" />
      </div>
    ) : (
      <ActionForm action={resolveSyncIssueAction.bind(null, i.id)} submitLabel="Marcar como revisada" variant="secondary" size="sm" />
    );
  }
  const revoked = !!i.device.revokedAt;
  const reject = i.conflict.kind === "price"
    ? resolvePriceConflictAction.bind(null, i.id, "reject")
    : rejectSyncConflictAction.bind(null, i.id);
  const otherWarehouses = i.conflict.kind === "stock" ? warehouses.filter((w) => w.id !== (i.conflict as StockConflictResult).warehouseId) : [];
  return (
    <div className="flex flex-wrap items-end gap-2">
      {!revoked && i.conflict.kind === "price" && (
        <>
          <ActionForm action={resolvePriceConflictAction.bind(null, i.id, "server")} submitLabel="Usar precios actuales" size="sm" />
          {canOverride && (
            <ActionForm action={resolvePriceConflictAction.bind(null, i.id, "client")} submitLabel="Respetar precios del teléfono" variant="secondary" size="sm" />
          )}
        </>
      )}
      {!revoked && i.type === "sale.convert" && i.conflict.kind === "stock" && otherWarehouses.length > 0 && (
        <ActionForm action={retrySyncConflictAction.bind(null, i.id)} submitLabel="Convertir desde otro almacén" size="sm" className="grid gap-2">
          <SelectField label="Almacén" name="warehouseId" options={otherWarehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        </ActionForm>
      )}
      {!revoked && <ActionForm action={retrySyncConflictAction.bind(null, i.id)} submitLabel="Reintentar" variant="secondary" size="sm" />}
      <ActionForm action={reject} submitLabel="Rechazar" variant="danger" size="sm" confirmText="Confirmo rechazar la operación" />
    </div>
  );
}
