// Reports the git commit the running image was built from (GIT_SHA, baked in at
// build time — see web/Dockerfile). The deploy workflow polls this until it
// matches the pushed commit, so a stale deploy (image not actually updated)
// fails loudly instead of passing a homepage health check.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    sha: process.env.GIT_SHA ?? 'unknown',
    builtAt: process.env.BUILD_TIME ?? null,
  });
}
