
// Esta es la página principal (Ruta: /)
// Actualmente solo muestra un 404 estético, ya que la aplicación real vive en /produccion
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
      {/* Texto grande (4xl), negrita, gris suave y no seleccionable con el ratón */}
      <h1 className="text-4xl font-bold text-gray-300 select-none">404</h1>
    </div>
  );
}
