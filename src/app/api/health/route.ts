/** Goal: Health check for probes and CI, reporting the commit this server is running. */
import { getBuildInfo } from "@/lib/build-info";

export async function GET() {
  const build = await getBuildInfo();

  // no-store so CI polling for a new commit never reads a cached answer
  return Response.json(
    { status: "ok", ...build },
    { headers: { "Cache-Control": "no-store" } },
  );
}
