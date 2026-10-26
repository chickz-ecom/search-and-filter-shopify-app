import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: [
      "app/**/*.test.{ts,tsx}",
      "workers/**/*.test.ts",
      "packages/**/*.test.ts",
      "services/**/*.test.ts",
      "scripts/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    environment: "node",
    setupFiles: ["test/setup.ts"],
    // Test tích hợp (Postgres/Redis/Typesense thật) đặt tên *.int.test.ts và tự skip khi thiếu dịch vụ.
    testTimeout: 20_000,
    env: { NODE_ENV: "test" },
  },
});
