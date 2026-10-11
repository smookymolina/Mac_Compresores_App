/** Normaliza un término de búsqueda igual que la columna Product.searchText: minúsculas y sin acentos. */
export function searchKey(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
