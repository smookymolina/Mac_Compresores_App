import { CheckCircle2, Smartphone } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listDevices, listSyncIssues } from "@/modules/sync/admin";
import { resolveSyncIssueAction, revokeDeviceAction } from "@/modules/sync/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader, type DataColumn } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Sincronización" };

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

export default async function SyncPage() {
  await requirePagePermission("users.manage");
  const [devices, issues] = await Promise.all([listDevices(), listSyncIssues({ take: 100 })]);
  const active = devices.filter((d) => !d.revokedAt).length;

  return (
    <>
      <PageHeader title="Sincronización" subtitle="Teléfonos con la app móvil y operaciones que el servidor no pudo aplicar." />
      <div className="grid grid-cols-1 gap-4">
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
                d.revokedAt ? <Badge key="s" tone="red">Revocado</Badge> : <Badge key="s" tone="green">Activo</Badge>,
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
                i.error ?? "—",
                <ActionForm key="r" action={resolveSyncIssueAction.bind(null, i.id)} submitLabel="Marcar como revisada" variant="secondary" size="sm" />,
              ],
              sort: [i.capturedAt.getTime(), i.userName, i.type, ISSUE_STATUS[i.status] ?? i.status, null, null],
            }))}
          />
        </Card>
      </div>
    </>
  );
}
