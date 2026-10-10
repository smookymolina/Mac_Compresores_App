import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listUsers } from "@/modules/users/service";
import { createUserAction, resendInvitationAction, updateUserAction } from "@/modules/users/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, PageHeader, SelectField } from "@/components/ui";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  await requirePagePermission("users.manage");
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
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <b>{u.name}</b> <span className="text-ink-soft">{u.email}</span>
                    <Badge tone="blue">{u.role.name}</Badge>
                    {!u.active && <Badge tone="red">Inactivo</Badge>}
                    {u.invitePending && <Badge tone="amber">Invitación pendiente</Badge>}
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
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Activo</label>
                  </ActionForm>
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
                <Field label="Correo" name="email" type="email" required />
                <SelectField label="Rol" name="roleId" options={roleOpts} />
              </>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
