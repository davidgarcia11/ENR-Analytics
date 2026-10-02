// Se ejecuta una vez al arrancar el servidor de Next.js (no en el build ni en el
// navegador). Arranca el seguimiento de conexión de las loteadoras por ping
// (lib/loteadora-ping.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { arrancarSeguimiento } = await import('./lib/loteadora-ping');
  const { getDb } = await import('./lib/sqlite');
  arrancarSeguimiento(getDb);
}
