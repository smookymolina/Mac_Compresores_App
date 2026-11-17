import { describe, expect, it } from "vitest";
import { OPEN_QUOTE_STATUSES } from "@/modules/dashboard/metrics";

describe("OPEN_QUOTE_STATUSES", () => {
  it("no incluye borradores (DRAFT)", () => {
    expect(OPEN_QUOTE_STATUSES).not.toContain("DRAFT");
  });

  it("incluye enviadas y aceptadas", () => {
    expect([...OPEN_QUOTE_STATUSES]).toEqual(["SENT", "ACCEPTED"]);
  });
});
