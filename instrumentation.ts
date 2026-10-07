/**
 * Runs once when the server starts. Every source gets vetted: the ones already
 * installed when this ships, and any that were added while the server was down.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startVetting } = await import("@/lib/vet-service");
  startVetting();
}
