import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listUsers } from "@/modules/users/service";
import { setMobileAccessAction } from "@/modules/sync/actions";
import { createUserAction, deleteUserAction, resendInvitationAction, updateUserAction, updateUserSignaturesAction } from "@/modules/users/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, PageHeader, SelectField } from "@/components/ui";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const me = await requirePagePermission("users.manage");
  const [users, roles] = await Promise.all([listUsers(), db.role.findMany({ orderBy: { name: "asc" } })]);
  const roleOpts = roles.map((r) => ({ value: r.id, label: r.name }));

  return (
    <>
      <PageHeader title="Usuarios y roles" subtitle="Cambiar rol, desactivar o restablecer contraseña cierra las sesiones abiertas del usuario." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Usuarios" />
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="p-4">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <b className="break-words">{u.name}</b> <span className="min-w-0 break-all text-ink-soft">{u.email}</span>
                    <Badge tone="blue">{u.role.name}</Badge>
                    {!u.active && <Badge tone="red">Inactivo</Badge>}
                    {u.invitePending && <Badge tone="amber">Invitación pendiente</Badge>}
                    {u.mobileAccess && <Badge tone="green">App móvil</Badge>}
                  </summary>
                  {u.invitePending && u.active && (
                    <div className="mt-3 rounded-md border border-line bg-panel-2 p-3">
                      <p className="mb-2 text-sm text-ink-soft">
                        Aún no activa su cuenta. Reenviar genera un enlace nuevo (vigente 72 horas) y anula el anterior.
                      </p>
                      <ActionForm action={resendInvitationAction.bind(null, u.id)} submitLabel="Reenviar invitación" variant="secondary" />
                    </div>
                  )}
                  <ActionForm action={updateUserAction.bind(null, u.id)} className="mt-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Nombre" name="name" defaultValue={u.name} required />
                      <SelectField label="Rol" name="roleId" defaultValue={u.roleId} options={roleOpts} />
                      <Field label="Nueva contraseña (opcional)" name="password" type="password" autoComplete="new-password" />
                    </div>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-0"><input type="checkbox" className="size-5 sm:size-4" name="active" defaultChecked={u.active} /> Activo</label>
                  </ActionForm>
                  <div className="mt-4 rounded-md border border-line p-3">
                    <p className="mb-2 text-sm font-semibold">App móvil</p>
                    <p className="mb-3 text-sm text-ink-soft">
                      Permite iniciar sesión y sincronizar desde la app del teléfono. Al quitar el acceso se revocan todos sus dispositivos.
                    </p>
                    <ActionForm action={setMobileAccessAction.bind(null, u.id)} submitLabel="Guardar acceso" variant="secondary">
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-0">
                        <input type="checkbox" className="size-5 sm:size-4" name="mobileAccess" defaultChecked={u.mobileAccess} /> Acceso a la app móvil
                      </label>
                    </ActionForm>
                  </div>
                  <div className="mt-4 rounded-md border border-line p-3">
                    <p className="mb-2 text-sm font-semibold">Firmas</p>
                    <p className="mb-3 text-sm text-ink-soft">
                      Firma de correo: {u.signatureHtml ? "cargada" : "sin cargar"} · Bloque de cotización: {u.quoteBlock ? "cargado" : "sin cargar"}.
                      Sube el HTML de la firma (100 KB máximo) y el PNG del bloque de asesor (1 MB máximo). Solo reemplaza lo que subas.
                    </p>
                    <ActionForm action={updateUserSignaturesAction.bind(null, u.id)} submitLabel="Guardar firmas" variant="secondary">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1 text-sm">
                          Firma de correo (.html)
                          <input type="file" name="signatureFile" accept=".html,text/html" className="w-full max-w-full min-w-0 text-sm" />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-sm">
                          Bloque de asesor para cotizaciones (.png)
                          <input type="file" name="blockFile" accept="image/png" className="w-full max-w-full min-w-0 text-sm" />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="clearHtml" className="size-5 sm:size-4" /> Quitar firma de correo</label>
                        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="clearBlock" className="size-5 sm:size-4" /> Quitar bloque de cotización</label>
                      </div>
                    </ActionForm>
                  </div>
                  {u.id !== me.id && (
                    <div className="mt-4 rounded-md border border-line p-3">
                      <p className="mb-2 text-sm text-ink-soft">
                        Eliminar borra la cuenta de forma permanente. Si tiene cotizaciones, ventas o movimientos no se puede eliminar: desactívala.
                      </p>
                      <ActionForm action={deleteUserAction.bind(null, u.id)} submitLabel="Eliminar cuenta" variant="danger"
                        confirmText={`Confirmo que quiero eliminar a ${u.name}`} />
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold">Invitar usuario</h2>
          <p className="mb-3 text-xs text-ink-soft">
            Le enviaremos un correo con un enlace (vigente 72 horas) para que elija su contraseña y active su cuenta.
          </p>
          <ActionForm action={createUserAction} resetOnSuccess submitLabel="Enviar invitación">
              <>
                <Field label="Nombre" name="name" required />
                <Field label="Correo" name="email" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
                <SelectField label="Rol" name="roleId" options={roleOpts} />
              </>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
