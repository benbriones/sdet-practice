/** Goal: Report which environment and commit this server is running, for the badge and health check. */
import { connection } from "next/server";

export interface BuildInfo {
  commitSha: string;
  shortSha: string;
  environment: string;
}

// Read per request, not at build, so Docker or Kubernetes can inject the values into one image
export async function getBuildInfo(): Promise<BuildInfo> {
  await connection();
  const commitSha = process.env.APP_COMMIT_SHA || "dev";

  return {
    commitSha,
    shortSha: commitSha.slice(0, 7),
    environment: process.env.APP_ENVIRONMENT || "local",
  };
}
