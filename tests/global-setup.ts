import { execSync } from "node:child_process";
import { loadEnv } from "vite";

export default function setup() {
  const url = loadEnv("test", process.cwd(), "").TEST_DATABASE_URL;
  if (!url || !/_test\b/.test(url)) throw new Error("TEST_DATABASE_URL debe apuntar a una BD *_test");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
}
