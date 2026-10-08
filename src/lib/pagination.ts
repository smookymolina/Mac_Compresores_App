/** Paginación por desplazamiento para listados largos (clientes, cotizaciones, ventas). */
export const LIST_PAGE_SIZE = 50;

export function pageArgs(page?: number) {
  const p = Math.max(1, Math.floor(page ?? 1) || 1);
  return { page: p, skip: (p - 1) * LIST_PAGE_SIZE, take: LIST_PAGE_SIZE };
}

export function paged<T>(items: T[], total: number, page: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / LIST_PAGE_SIZE)) };
}
