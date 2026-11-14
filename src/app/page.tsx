/** Goal: Task list page, with a badge naming the build that served it. */
import { Suspense } from "react";
import { BuildBadge, BuildBadgeFallback } from "@/components/build-badge";
import { TaskManager } from "@/components/task-manager";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        {/* Request-time env reads must sit inside Suspense under Cache Components */}
        <Suspense fallback={<BuildBadgeFallback />}>
          <BuildBadge />
        </Suspense>
      </header>
      <TaskManager />
    </main>
  );
}
