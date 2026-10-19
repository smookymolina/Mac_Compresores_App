import { useState } from "react";
import { fmtDateTime } from "@domain/format";
import { fmtPct } from "@domain/money";
import { useApp, type EntityRow } from "../core";
import { Alert, Badge, Button, Card, Empty, Facts, Loading, SearchBox, useAsync, useDebounced } from "../ui/kit";
import { LINE_LABEL, money, qty, str } from "../ui/format";

const PAGE = 50;

/** Lista paginada con búsqueda local (34k productos: nunca se cargan todos). */
export function CatalogList({ onOpen }: { onOpen: (id: string) => void }) {
  const { controller, lastSyncAt } = useApp();
  const store = controller.store;
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [limit, setLimit] = useState(PAGE);
  const total = useAsync(() => store.count("Product"), [lastSyncAt]);
  const rows = useAsync(
    () => (dq ? store.search<EntityRow>("Product", dq, limit) : store.list<"Product", EntityRow>("Product", { orderBy: "sku", limit })),
    [dq, limit, lastSyncAt],
  );
  const items = rows.data ?? [];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-2 pt-1">
        <SearchBox label="Buscar producto" placeholder="SKU, número de parte o descripción" value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} />
        {total.data !== undefined && <p className="mt-1 text-xs text-muted">{total.data.toLocaleString("es-MX")} productos en el teléfono</p>}
      </div>
      {rows.error && <Alert>{rows.error} <button className="underline" onClick={rows.reload}>Reintentar</button></Alert>}
      {rows.loading && !rows.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title={dq ? "Sin resultados" : "Catálogo vacío"}>{dq ? `No hay productos que coincidan con «${dq}».` : "Sincroniza para descargar el catálogo."}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpen(p.id)} className="block min-h-11 w-full px-4 py-3 text-left hover:bg-panel-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-sm font-medium text-accent-fg">{str(p.sku)}</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{money(p.price, str(p.currency) ?? "MXN")}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{str(p.description)}</span>
                {p.status === "INACTIVE" && <span className="mt-1 inline-block"><Badge tone="warn">Inactivo</Badge></span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length >= limit && (
        <Button variant="secondary" className="w-full" busy={rows.loading} onClick={() => setLimit((l) => l + PAGE)}>Mostrar {PAGE} más</Button>
      )}
    </div>
  );
}

export function ProductDetail({ id }: { id: string }) {
  const { controller, lastSyncAt } = useApp();
  const store = controller.store;
  const r = useAsync(async () => {
    const [p, balances, warehouses] = await Promise.all([
      store.get("Product", id),
      store.list<"StockBalance", EntityRow>("StockBalance", { where: { productId: id } }),
      store.list<"Warehouse", EntityRow>("Warehouse", {}),
    ]);
    const wh = new Map(warehouses.map((w) => [w.id, w]));
    return { p, stock: balances.map((b) => ({ id: b.id, wh: wh.get(String(b.warehouseId)), quantity: b.quantity })) };
  }, [id, lastSyncAt]);

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <Alert>{r.error}</Alert>;
  const p = r.data?.p;
  if (!p) return <Empty title="Producto no encontrado">Puede que ya no esté disponible en el catálogo.</Empty>;
  const currency = str(p.currency) ?? "MXN";
  const stock = r.data!.stock;

  // Nunca se muestran cost/markup/shipping/consumables aunque vengan en la fila.
  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-sm font-medium text-accent-fg">{str(p.sku)}</p>
        <h1 className="mt-1 text-lg font-semibold text-ink">{str(p.description)}</h1>
        {p.status === "INACTIVE" && <div className="mt-1"><Badge tone="warn">Inactivo</Badge></div>}
      </div>
      <Card>
        <p className="text-sm text-muted">Precio de lista</p>
        <p className="text-2xl font-semibold tabular-nums text-ink">{money(p.price, currency)}</p>
        <p className="text-sm text-muted">+ IVA {p.taxRate !== undefined && p.taxRate !== null ? fmtPct(p.taxRate as string) : "—"}</p>
      </Card>
      <Card title="Datos">
        <Facts rows={[
          ["SKU", str(p.sku)],
          ["Línea", LINE_LABEL[String(p.line)] ?? str(p.line)],
          ["Tipo", p.kind === "SERVICE" ? "Servicio" : "Producto"],
          ["Unidad", str(p.unit)],
          ["Moneda", currency],
          ["Fabricante", str(p.oemName)],
          ["No. de parte", str(p.oemPartNumber)],
        ]} />
      </Card>
      <Card title="Existencias">
        {stock.length === 0 ? (
          <p className="text-sm text-muted">Sin existencias registradas.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {stock.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-ink">{s.wh ? `${str(s.wh.code)} · ${str(s.wh.name)}` : "Almacén"}</span>
                <span className="shrink-0 font-medium tabular-nums text-ink">{qty(s.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Al {lastSyncAt ? fmtDateTime(lastSyncAt) : "—"} (última sincronización).</p>
      </Card>
    </div>
  );
}
