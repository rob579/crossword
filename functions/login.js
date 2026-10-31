// GET /login – this path is protected by Cloudflare Access (Google sign-in).
// Reaching it means sign-in worked and the CF_Authorization cookie is set,
// so send the browser back to the app, which finishes signing in.
export async function onRequestGet() {
  return new Response(null, { status: 302, headers: { Location: '/#/signed-in', 'Cache-Control': 'no-store' } });
}
