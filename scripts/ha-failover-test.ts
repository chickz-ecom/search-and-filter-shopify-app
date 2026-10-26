// Kiểm chứng HA Typesense 3 node (task 6.2): index qua cluster, dừng 1 node (kể cả leader) giữa lúc search liên tục,
// đo số request lỗi, rồi bật lại và kiểm tra node đó bắt kịp dữ liệu ghi trong lúc nó tắt.
//   docker compose -f deploy/typesense-ha/docker-compose.yml up -d && npx tsx scripts/ha-failover-test.ts
import { execSync } from "node:child_process";
import { TypesenseEngine } from "../app/lib/search/typesense-engine";

const NODES = [8211, 8212, 8213].map((port) => ({
  host: "localhost",
  port,
  protocol: "http" as const,
}));
const KEY = process.env.TYPESENSE_API_KEY ?? "dev-typesense-key";
const cluster = new TypesenseEngine({
  host: "",
  port: 0,
  protocol: "http",
  apiKey: KEY,
  nodes: NODES,
  connectionTimeoutSeconds: 2,
});
const single = (port: number) =>
  new TypesenseEngine({ host: "localhost", port, protocol: "http", apiKey: KEY });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function leaderPort(): Promise<number | null> {
  for (const n of NODES) {
    const r = await fetch(`http://localhost:${n.port}/debug`, {
      headers: { "X-TYPESENSE-API-KEY": KEY },
    }).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { state?: number }) : null;
    if (j?.state === 1) return n.port; // 1 = LEADER
  }
  return null;
}

async function waitHealthy(ports: number[], timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await Promise.all(ports.map((p) => single(p).health()));
    if (ok.every(Boolean) && (await leaderPort())) return;
    await sleep(500);
  }
  throw new Error("cluster not healthy");
}

async function main() {
  await waitHealthy([8211, 8212, 8213]);
  const name = `ha_${Date.now()}`;
  await cluster.createCollection({
    name,
    fields: [
      { name: "title", type: "string" },
      { name: "n", type: "int32", sort: true },
    ],
  });
  await cluster.importDocuments(
    name,
    Array.from({ length: 2000 }, (_, i) => ({
      id: String(i),
      title: `product ${i % 50} item`,
      n: i,
    })),
  );
  await sleep(1000);

  const leader = (await leaderPort())!;
  const victim = NODES.findIndex((n) => n.port === leader) + 1; // ts1..ts3
  let ok = 0;
  let failed = 0;
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const r = await cluster.search(name, { q: "product", queryBy: ["title"], perPage: 1 });
        if (r.found === 2000 || r.found > 0) ok++;
      } catch {
        failed++;
      }
    }
  })();
  await sleep(2000);
  console.log(`stopping leader ts${victim} (port ${leader})`);
  execSync(`docker compose -f deploy/typesense-ha/docker-compose.yml stop ts${victim}`, {
    stdio: "ignore",
  });
  const t0 = Date.now();
  await sleep(8000);
  // Ghi trong lúc thiếu 1 node: cluster còn quorum 2/3 → ghi được sau khi bầu leader mới.
  let writeOk = false;
  for (let i = 0; i < 20 && !writeOk; i++) {
    writeOk = await cluster
      .importDocuments(name, [{ id: "2000", title: "written during failover", n: 2000 }])
      .then((r) => r.failed === 0)
      .catch(() => false);
    if (!writeOk) await sleep(1000);
  }
  const newLeader = await leaderPort();
  stop = true;
  await loop;
  console.log(`restarting ts${victim}`);
  execSync(`docker compose -f deploy/typesense-ha/docker-compose.yml start ts${victim}`, {
    stdio: "ignore",
  });
  await waitHealthy([8211, 8212, 8213], 90_000);
  await sleep(3000);
  const caughtUp = await single(leader).search(name, {
    q: "failover",
    queryBy: ["title"],
    perPage: 1,
  });
  await cluster.dropCollection(name);
  console.log(
    JSON.stringify(
      {
        searchesOk: ok,
        searchesFailed: failed,
        failoverWindowS: Math.round((Date.now() - t0) / 1000),
        newLeaderPort: newLeader,
        writeDuringFailover: writeOk,
        restartedNodeCaughtUp: caughtUp.found === 1,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
