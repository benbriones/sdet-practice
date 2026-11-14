/** Goal: Show which environment and commit served this page, to confirm a deploy at a glance. */
import { getBuildInfo } from "@/lib/build-info";

const badgeClass =
  "flex items-center gap-2 rounded-full border border-zinc-300 px-3 py-1 font-mono text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400";

export async function BuildBadge() {
  const build = await getBuildInfo();

  return (
    <dl aria-label="Build" className={badgeClass}>
      <dt className="sr-only">Environment</dt>
      <dd data-testid="build-environment">{build.environment}</dd>
      <dd aria-hidden>·</dd>
      <dt className="sr-only">Commit</dt>
      <dd data-testid="build-commit" title={build.commitSha}>
        {build.shortSha}
      </dd>
    </dl>
  );
}

// Holds the badge's space in the static shell while the request-time values stream in
export function BuildBadgeFallback() {
  return <div className={`${badgeClass} w-28 animate-pulse`}>&nbsp;</div>;
}
