// GET /logout – forget the site's sign-in cookie (not protected by Access).
export async function onRequestGet() {
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': 'cw_auth=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax' },
  });
}
