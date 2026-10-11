import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import { homePath, type CurrentUser } from "@/lib/auth/session";
import { customerScope } from "@/modules/customers/service";
import { asSeller } from "@/modules/dashboard/service";

const user = (role: RoleCode, id = "u1"): CurrentUser => ({ id, name: role, email: `${role}@t`, role, roleName: role, permissions: new Set(ROLE_PERMISSIONS[role]) });

describe("permisos por rol", () => {
  it("almacén solo ve catálogo e inventario y entra a inventario", () => {
    expect([...ROLE_PERMISSIONS.ALMACEN].sort()).toEqual(["inventory.read", "inventory.write", "products.read"]);
    expect(homePath(user("ALMACEN"))).toBe("/inventario");
  });
  it("gerencia consulta comisiones pero no las edita ni ve auditoría", () => {
    const g = ROLE_PERMISSIONS.GERENCIA;
    expect(g).toContain("commissions.read_all");
    for (const p of ["commissions.manage", "commissions.approve", "audit.read"] as const) expect(g).not.toContain(p);
  });
  it("ventas solo ve sus clientes", () => {
    expect(customerScope(user("VENTAS"))).toEqual({ ownerId: "u1" });
    expect(customerScope(user("ADMIN"))).toEqual({});
  });
  it("el administrador puede ver el dashboard como un vendedor", () => {
    const v = asSeller(user("ADMIN"), { id: "s1", name: "Vendedor" });
    expect(v.id).toBe("s1");
    expect([...v.permissions].some((p) => p.endsWith(".read_all"))).toBe(false);
    expect(customerScope(v)).toEqual({ ownerId: "s1" });
  });
});
