import { PrismaClient } from "@prisma/client";

// Prisma cho integration test (DATABASE_URL từ .env.test → DB search_app_test).
let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Refusing to run DB tests against a non-test database");
  }
  client ??= new PrismaClient();
  return client;
}
