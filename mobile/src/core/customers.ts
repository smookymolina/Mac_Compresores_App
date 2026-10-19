import { dec } from "@domain/money";
import type { EntityRow, SyncCommand } from "./api";
import { LocalRuleError, LocalService, clean, type EntitySync } from "./local";
import { colValue } from "./store";

// ---------- Tipos ----------

export interface LocalContact { id: string; name: string; position: string | null; email: string | null; phone: string | null; _sync?: EntitySync }
export interface LocalAddress { id: string; label: string; street: string; city: string | null; state: string | null; zip: string | null; _sync?: EntitySync }

/** Fila local de Customer: misma forma que `/api/sync/pull` (con contactos y direcciones) + `_sync`. */
export interface LocalCustomer extends EntityRow {
  id: string;
  legalName: string;
  rfc: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number;
  creditLimit: string | null;
  notes: string | null;
  ownerId: string | null;
  active: boolean;
  contacts: LocalContact[];
  addresses: LocalAddress[];
  createdAt?: string;
  updatedAt: string;
  _sync?: EntitySync;
}

/** Campos editables de `customer.save` (los que viajan en `changedFields`). */
export const CUSTOMER_FIELDS = ["legalName", "rfc", "email", "phone", "paymentTermsDays", "creditLimit", "notes"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export interface CustomerFields {
  legalName: string;
  rfc?: string | null;
  email?: string | null;
  phone?: string | null;
  paymentTermsDays?: number;
  /** Decimal como string ("50000", "50000.00"). */
  creditLimit?: string | null;
  notes?: string | null;
}
export interface ContactInput { name: string; position?: string | null; email?: string | null; phone?: string | null }
export interface AddressInput { label?: string; street: string; city?: string | null; state?: string | null; zip?: string | null }
export interface CustomerInput extends CustomerFields { contact?: ContactInput; address?: AddressInput }

type Normalized = { legalName: string; rfc: string | null; email: string | null; phone: string | null; paymentTermsDays: number; creditLimit: string | null; notes: string | null };

// ---------- Validación (mismas reglas que customers/input.ts del servidor) ----------

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEC_RE = /^\d+(\.\d{1,2})?$/;

function checkEmail(e: string | null) {
  if (e && !EMAIL_RE.test(e)) throw new LocalRuleError(`Correo inválido: ${e}`);
}

export function normalizeCustomer(f: CustomerFields): Normalized {
  const legalName = (f.legalName ?? "").trim();
  if (legalName.length < 2) throw new LocalRuleError("La razón social es obligatoria.");
  const rfc = clean(f.rfc)?.toUpperCase() ?? null;
  if (rfc && !RFC_RE.test(rfc)) throw new LocalRuleError("RFC inválido.");
  const email = clean(f.email);
  checkEmail(email);
  const days = f.paymentTermsDays ?? 0;
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new LocalRuleError("Días de crédito inválidos (0–365).");
  const cl = clean(f.creditLimit);
  if (cl && !DEC_RE.test(cl)) throw new LocalRuleError("Límite de crédito inválido.");
  return { legalName, rfc, email, phone: clean(f.phone), paymentTermsDays: days, creditLimit: cl ? dec(cl).toFixed(2) : null, notes: clean(f.notes) };
}

const fieldsOf = (c: LocalCustomer): CustomerFields => ({
  legalName: c.legalName, rfc: c.rfc, email: c.email, phone: c.phone, paymentTermsDays: Number(c.paymentTermsDays ?? 0),
  creditLimit: c.creditLimit === null || c.creditLimit === undefined ? null : String(c.creditLimit), notes: c.notes,
});

const same = (k: CustomerField, a: unknown, b: unknown) =>
  k === "creditLimit" && a != null && b != null ? dec(a as string).eq(dec(b as string)) : colValue(a ?? null) === colValue(b ?? null);

/** Payload de `customer.save`: alta omite vacíos; edición manda "" para borrar (el servidor lo toma como vacío). */
function savePayload(n: Normalized, mode: "create" | "update") {
  const out: Record<string, unknown> = { legalName: n.legalName, paymentTermsDays: n.paymentTermsDays };
  for (const k of ["rfc", "email", "phone", "creditLimit", "notes"] as const) {
    if (n[k] !== null) out[k] = n[k];
    else if (mode === "update") out[k] = "";
  }
  return out;
}

function contactRow(id: string, i: ContactInput): LocalContact {
  const name = (i.name ?? "").trim();
  if (name.length < 2) throw new LocalRuleError("El nombre del contacto es obligatorio.");
  const email = clean(i.email);
  checkEmail(email);
  return { id, name, position: clean(i.position), email, phone: clean(i.phone) };
}
function addressRow(id: string, i: AddressInput): LocalAddress {
  const street = (i.street ?? "").trim();
  if (street.length < 3) throw new LocalRuleError("La calle es obligatoria.");
  return { id, label: clean(i.label) ?? "Principal", street, city: clean(i.city), state: clean(i.state), zip: clean(i.zip) };
}
const strip = <T extends { _sync?: unknown }>({ _sync: _s, ...r }: T) => r;
const opt = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined));

// ---------- Servicio ----------

/** Clientes locales: alta/edición (con `changedFields`), contactos y direcciones. Requiere `customers.write`. */
export class CustomerService extends LocalService {
  private async writable() {
    await this.require("customers.write", "No tienes permiso para capturar clientes.");
    await this.assertCapture();
  }

  private async checkRfc(rfc: string | null, selfId: string) {
    if (!rfc) return;
    const dup = (await this.o.store.list<"Customer", LocalCustomer>("Customer", { where: { rfc } })).find((c) => c.id !== selfId);
    if (dup) throw new LocalRuleError(`El RFC ${rfc} ya pertenece a ${dup.legalName}.`);
  }

  /** Alta local (UUID del teléfono) + `customer.save` en el outbox. */
  async createCustomer(input: CustomerInput): Promise<LocalCustomer> {
    await this.writable();
    const n = normalizeCustomer(input);
    await this.checkRfc(n.rfc, "");
    const user = await this.user();
    const id = this.uuid();
    const contact = input.contact ? contactRow(this.uuid(), input.contact) : null;
    const address = input.address ? addressRow(this.uuid(), input.address) : null;
    const cmd = await this.enqueue("customer.save", {
      id, ...savePayload(n, "create"),
      ...(contact && { contact: opt(strip({ ...contact, id: undefined })) }),
      ...(address && { address: opt({ street: address.street, city: address.city, state: address.state, zip: address.zip }) }),
    });
    const nowIso = cmd.capturedAt;
    const row: LocalCustomer = {
      id, ...n, ownerId: user.id, active: true, contacts: contact ? [contact] : [], addresses: address ? [address] : [],
      createdAt: nowIso, updatedAt: nowIso, _sync: { state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: false },
    };
    await this.o.store.put("Customer", [row]);
    await this.changed();
    return row;
  }

  /**
   * Edita un cliente. Solo viajan en `changedFields` los campos que cambió el usuario (contra la fila local);
   * `baseUpdatedAt` = última versión del servidor. Si el comando anterior aún no se envió, se reescribe.
   */
  async updateCustomer(customerId: string, patch: Partial<CustomerFields>): Promise<LocalCustomer> {
    await this.writable();
    await this.o.beforeWrite?.();
    const c = await this.mustGet(customerId);
    const before = normalizeCustomer(fieldsOf(c));
    const after = normalizeCustomer({ ...fieldsOf(c), ...patch } as CustomerFields);
    const changed = CUSTOMER_FIELDS.filter((k) => !same(k, before[k], after[k]));
    if (!changed.length) return c;
    if (changed.includes("rfc")) await this.checkRfc(after.rfc, c.id);
    const sync: EntitySync = c._sync ?? { state: "applied", commandId: null, onServer: true, baseUpdatedAt: c.updatedAt };
    let cmd: SyncCommand | undefined;
    const old = sync.state === "pending" && sync.commandType === "customer.save" && sync.commandId
      ? (await this.o.store.outbox(1000)).find((e) => e.cmd.id === sync.commandId)?.cmd : undefined;
    if (old) {
      const prevChanged = old.payload.changedFields as string[] | undefined;
      const payload = prevChanged
        ? { id: c.id, ...savePayload(after, "update"), baseUpdatedAt: old.payload.baseUpdatedAt, changedFields: CUSTOMER_FIELDS.filter((k) => prevChanged.includes(k) || changed.includes(k)) }
        : { ...old.payload, ...savePayload(after, "create") };
      const next = { ...old, capturedAt: this.nowIso(), payload };
      if (await this.o.store.replaceOutbox(next)) cmd = next;
    }
    if (!cmd) {
      cmd = sync.onServer
        ? await this.enqueue("customer.save", { id: c.id, ...savePayload(after, "update"), baseUpdatedAt: sync.baseUpdatedAt ?? c.updatedAt, changedFields: changed })
        : await this.enqueue("customer.save", { id: c.id, ...savePayload(after, "create") });
    }
    const row: LocalCustomer = { ...c, ...after, updatedAt: this.nowIso(), _sync: this.pending(sync, cmd, sync.onServer) };
    await this.o.store.put("Customer", [row]);
    await this.changed();
    return row;
  }

  private async mustGet(id: string) {
    const c = await this.getCustomer(id);
    if (!c) throw new LocalRuleError("Cliente no encontrado en el teléfono.");
    return { ...c, contacts: c.contacts ?? [], addresses: c.addresses ?? [] };
  }

  private async touch(c: LocalCustomer, cmd: SyncCommand, patch: Partial<LocalCustomer>) {
    const row: LocalCustomer = { ...c, ...patch, _sync: this.pending(c._sync, cmd, true) };
    await this.o.store.put("Customer", [row]);
    await this.changed();
    return row;
  }

  async addContact(customerId: string, input: ContactInput): Promise<LocalCustomer> {
    await this.writable();
    const c = await this.mustGet(customerId);
    const ct = contactRow(this.uuid(), input);
    const cmd = await this.enqueue("customer.contact.add", { customerId: c.id, ...opt(strip(ct)) });
    return this.touch(c, cmd, { contacts: [...c.contacts, { ...ct, _sync: { state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: false } }] });
  }

  async removeContact(customerId: string, contactId: string): Promise<LocalCustomer> {
    await this.writable();
    const c = await this.mustGet(customerId);
    if (!c.contacts.some((x) => x.id === contactId)) throw new LocalRuleError("Contacto no encontrado.");
    const cmd = await this.enqueue("customer.contact.remove", { customerId: c.id, contactId });
    return this.touch(c, cmd, { contacts: c.contacts.filter((x) => x.id !== contactId) });
  }

  async addAddress(customerId: string, input: AddressInput): Promise<LocalCustomer> {
    await this.writable();
    const c = await this.mustGet(customerId);
    const ad = addressRow(this.uuid(), input);
    const cmd = await this.enqueue("customer.address.add", { customerId: c.id, ...opt(strip(ad)) });
    return this.touch(c, cmd, { addresses: [...c.addresses, { ...ad, _sync: { state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: false } }] });
  }

  async removeAddress(customerId: string, addressId: string): Promise<LocalCustomer> {
    await this.writable();
    const c = await this.mustGet(customerId);
    if (!c.addresses.some((x) => x.id === addressId)) throw new LocalRuleError("Dirección no encontrada.");
    const cmd = await this.enqueue("customer.address.remove", { customerId: c.id, addressId });
    return this.touch(c, cmd, { addresses: c.addresses.filter((x) => x.id !== addressId) });
  }

  async getCustomer(id: string): Promise<LocalCustomer | null> { return this.o.store.get<LocalCustomer>("Customer", id); }

  /** Lista local por razón social; `q` busca por razón social/RFC/correo/teléfono. */
  async listCustomers(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<LocalCustomer[]> {
    if (opts.q?.trim()) return this.o.store.search<LocalCustomer>("Customer", opts.q, opts.limit ?? 50);
    return this.o.store.list<"Customer", LocalCustomer>("Customer", { orderBy: "legalName", limit: opts.limit ?? 200, offset: opts.offset });
  }
}
