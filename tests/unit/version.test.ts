import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { APP_VERSION } from "@/lib/version";

describe("APP_VERSION", () => {
  it("coincide con package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });
});
