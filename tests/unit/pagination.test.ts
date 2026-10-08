import { describe, expect, it } from "vitest";
import { LIST_PAGE_SIZE, pageArgs, paged } from "@/lib/pagination";

describe("paginación", () => {
  it("normaliza páginas inválidas a 1", () => {
    for (const p of [undefined, 0, -3, Number.NaN]) expect(pageArgs(p)).toEqual({ page: 1, skip: 0, take: LIST_PAGE_SIZE });
  });
  it("calcula desplazamiento y total de páginas", () => {
    expect(pageArgs(3).skip).toBe(2 * LIST_PAGE_SIZE);
    expect(paged([], 0, 1).pages).toBe(1);
    expect(paged([], LIST_PAGE_SIZE + 1, 2).pages).toBe(2);
  });
});
