import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listUsers } from "@/modules/users/service";
import { createUserAction, updateUserAction } from "@/modules/users/actions";
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
      <div className="grid gap-4 lg:grid-cols-3">
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
                  </summary>
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
          <h2 className="mb-3 text-sm font-semibold">Nuevo usuario</h2>
          <ActionForm action={createUserAction} resetOnSuccess submitLabel="Crear usuario">
            {(e) => (
              <>
                <Field label="Nombre" name="name" required error={e?.name} />
                <Field label="Correo" name="email" type="email" required error={e?.email} />
                <SelectField label="Rol" name="roleId" options={roleOpts} />
                <Field label="Contraseña inicial" name="password" type="password" autoComplete="new-password" required minLength={10} error={e?.password} />
              </>
            )}
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
