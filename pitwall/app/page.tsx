import { redirect } from "next/navigation";
import { connection } from "next/server";
import { redis, sessionsOf } from "@/lib/redis";

// Open on the session the worker is streaming, else the latest finished one.
export default async function Home() {
  await connection();
  const live = await redis.get("f1:live");
  if (live) redirect(`/${live}`);
  const year = new Date().getUTCFullYear();
  let reason = "";
  let latest: number | undefined;
  for (const y of [year, year - 1]) {
    try {
      latest = (await sessionsOf(y)).filter((s) => Date.parse(s.date_end) + 1800_000 < Date.now()).at(-1)?.session_key;
      if (latest) break;
    } catch (e) {
      reason = (e as Error).message;
    }
  }
  if (latest) redirect(`/${latest}`);
  return (
    <main className="mx-auto max-w-xl p-10 text-fog">
      <h1 className="wide mb-3 text-2xl font-bold text-chalk">Pitwall can’t reach OpenF1</h1>
      <p className="mb-4">
        No session list is cached yet and OpenF1 refused the request. During a live session the free API is locked;
        add your OpenF1 credentials to <code className="text-chalk">.env.local</code> or open a session directly at{" "}
        <code className="text-chalk">/&lt;session_key&gt;</code>.
      </p>
      <p className="text-sm text-dim">{reason}</p>
    </main>
  );
}
