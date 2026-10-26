import net from "node:net";

/** Kiểm tra cổng TCP mở — để integration test tự skip khi thiếu dịch vụ. */
export function portOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

export const typesenseUp = () =>
  portOpen(process.env.TYPESENSE_HOST ?? "localhost", Number(process.env.TYPESENSE_PORT ?? 8108));
export const redisUp = () => {
  const u = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return portOpen(u.hostname, Number(u.port || 6379));
};
export const postgresUp = () => {
  const u = new URL(process.env.DATABASE_URL ?? "postgresql://localhost:5432/x");
  return portOpen(u.hostname, Number(u.port || 5432));
};
