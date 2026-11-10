// Compartir un componente Nova (gráfico, KPIs, tabla o la página entera) como imagen PNG.
//
// El botón abre una vista previa de una «lámina»: cabecera con el logo, el panel y el título, el
// componente tal como se ve (con el tema claro/oscuro de quien la genera) y un pie con los filtros
// aplicados, «Uso interno», quién la generó y cuándo. La imagen se dibuja con html-to-image, que usa
// el propio navegador (respeta los colores oklch de Tailwind 4 y la fuente Geist).
//
// Uso en un panel (ver components/nova/README.md § «Compartir como imagen»):
//   <CompartirProvider valor={{ panel: "Nivel de servicio", seccion: "Indicadores", filtros: [...] }}>
//     <Compartible titulo="% OTIF por canal">{(boton) => <Charts16 accion={boton} ... />}</Compartible>
//   </CompartirProvider>
//
// Marcas en el DOM del componente:
//   data-compartir-ocultar   → no sale en la imagen (botones, filtros de tabla, menús «⋮»)
//   data-compartir-completo  → sale entero: se quita `hidden`/truncado (p. ej. el texto de la incidencia)
//
// Copiar al portapapeles solo funciona en HTTPS o localhost (lo exige el navegador): por HTTP solo
// se ofrece descargar.
"use client";

import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from "react";
import { toPng, getFontEmbedCSS } from "html-to-image";
import { Copy, Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/nova/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import { useSession } from "@/components/SessionProvider";
import { cn } from "@/lib/utils";

export interface InfoCompartir {
  panel: string; // «Nivel de servicio»
  seccion?: string; // «Indicadores»
  filtros: string[]; // líneas del pie: «Entrega prometida 01/10/26 – 31/10/26», «Todos menos 2 clientes»...
}

const CompartirCtx = createContext<InfoCompartir | null>(null);

export function CompartirProvider({ valor, children }: { valor: InfoCompartir; children: ReactNode }) {
  return <CompartirCtx.Provider value={valor}>{children}</CompartirCtx.Provider>;
}

// Envuelve un componente y le da su botón «Compartir» (render-prop: cada bloque lo coloca en su cabecera)
export function Compartible({ titulo, className, children }: { titulo: string; className?: string; children: (boton: ReactNode) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={className}>
      {children(<BotonCompartir objetivo={ref} titulo={titulo} />)}
    </div>
  );
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pad = (n: number) => String(n).padStart(2, "0");
const ahora = () => {
  const d = new Date();
  return { iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, texto: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

// Las fuentes se incrustan una sola vez por sesión (leerlas de las hojas de estilo es lo más lento)
let fuentesCss: Promise<string> | null = null;

const MAX_LADO_PX = 16000; // límite práctico de un canvas en los navegadores

// Copia el nodo, lo deja «para foto» (sin scroll ni truncados, sin lo marcado como ocultar) y lo monta
// en una lámina fuera de pantalla dentro del mismo [data-nova-theme], para que herede tema y colores.
function montarLamina(nodo: HTMLElement, cabecera: { contexto: string; titulo: string }, pie: string[]) {
  const temaRaiz = (nodo.closest("[data-nova-theme]") as HTMLElement | null) ?? document.body;
  const clon = nodo.cloneNode(true) as HTMLElement;

  // Contenedores con scroll: en la copia se despliegan enteros (p. ej. una tabla más ancha que la pantalla)
  const originales = [nodo, ...Array.from(nodo.querySelectorAll<HTMLElement>("*"))];
  const copias = [clon, ...Array.from(clon.querySelectorAll<HTMLElement>("*"))];
  let anchoExtra = 0;
  originales.forEach((o, i) => {
    const c = copias[i];
    if (!c) return;
    const cs = getComputedStyle(o);
    const desplazaX = /(auto|scroll)/.test(cs.overflowX) && o.scrollWidth > o.clientWidth;
    const desplazaY = /(auto|scroll)/.test(cs.overflowY) && o.scrollHeight > o.clientHeight;
    if (desplazaX) anchoExtra = Math.max(anchoExtra, o.scrollWidth - o.clientWidth);
    if (desplazaX || desplazaY) {
      c.style.overflow = "visible";
      c.style.maxHeight = "none";
      if (desplazaY) c.style.height = "auto";
    }
  });
  clon.querySelectorAll("[data-compartir-ocultar]").forEach((e) => e.remove());
  clon.querySelectorAll<HTMLElement>("[data-compartir-completo]").forEach((e) => {
    e.classList.remove("hidden", "truncate");
    Object.assign(e.style, { display: "block", whiteSpace: "normal", overflow: "visible", textOverflow: "clip", maxWidth: "18rem" });
  });
  const ancho = Math.max(nodo.offsetWidth + anchoExtra, 480);
  clon.style.width = `${ancho}px`;
  clon.style.margin = "0";

  // Lámina: marco de color suave, tarjeta con cabecera, el componente y el pie
  const lamina = document.createElement("div");
  lamina.setAttribute("data-nova-theme", temaRaiz.getAttribute("data-nova-theme") ?? "light");
  lamina.className = "bg-muted p-6 text-foreground";
  Object.assign(lamina.style, { position: "fixed", left: "-100000px", top: "0", width: `${ancho + 48 + 48}px`, fontFamily: getComputedStyle(nodo).fontFamily });

  const tarjeta = document.createElement("div");
  tarjeta.className = "rounded-2xl border border-border bg-background p-6 shadow-sm";

  const head = document.createElement("div");
  head.className = "mb-5 flex items-center gap-4 border-b border-border pb-4";
  const chip = document.createElement("div");
  chip.className = "rounded-lg bg-white px-2.5 py-1.5"; // el logo es para fondo claro: en tema oscuro va sobre blanco
  const logo = document.createElement("img");
  logo.src = "/logo.png";
  logo.alt = "Elaborados Naturales";
  logo.className = "h-8 w-auto";
  chip.appendChild(logo);
  const textos = document.createElement("div");
  textos.className = "min-w-0";
  const ctx = document.createElement("p");
  ctx.className = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
  ctx.textContent = cabecera.contexto;
  const tit = document.createElement("p");
  tit.className = "text-lg font-semibold text-foreground";
  tit.textContent = cabecera.titulo;
  textos.append(ctx, tit);
  head.append(chip, textos);

  const foot = document.createElement("div");
  foot.className = "mt-5 space-y-1 border-t border-border pt-4 text-xs text-muted-foreground";
  pie.forEach((linea, i) => {
    const p = document.createElement("p");
    p.textContent = linea;
    if (i === pie.length - 1) p.className = "font-medium";
    foot.appendChild(p);
  });

  tarjeta.append(head, clon, foot);
  lamina.appendChild(tarjeta);
  temaRaiz.appendChild(lamina);
  return lamina;
}

async function generarPng(nodo: HTMLElement, cabecera: { contexto: string; titulo: string }, pie: string[]) {
  const lamina = montarLamina(nodo, cabecera, pie);
  try {
    // Espera a que cargue el logo de la cabecera
    await Promise.all(Array.from(lamina.querySelectorAll("img")).map((img) => (img.complete ? null : img.decode().catch(() => null))));
    fuentesCss ??= getFontEmbedCSS(lamina).catch(() => "");
    const { width, height } = lamina.getBoundingClientRect();
    const pixelRatio = Math.min(2, MAX_LADO_PX / width, MAX_LADO_PX / height);
    return await toPng(lamina, {
      pixelRatio,
      fontEmbedCSS: await fuentesCss,
      backgroundColor: getComputedStyle(lamina).backgroundColor,
      style: { position: "static", left: "0" }, // la copia que se dibuja, en su sitio (la lámina vive fuera de pantalla)
    });
  } finally {
    lamina.remove();
  }
}

export function BotonCompartir({ objetivo, titulo, conTexto = false, className }: {
  objetivo: RefObject<HTMLElement | null>;
  titulo: string;
  conTexto?: boolean; // «Compartir» con texto (barra de filtros) o solo el icono (cabecera de un bloque)
  className?: string;
}) {
  const info = useContext(CompartirCtx);
  const { user } = useSession();
  const [abierto, setAbierto] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [nombreArchivo, setNombreArchivo] = useState("imagen.png");
  const puedeCopiar = typeof window !== "undefined" && window.isSecureContext && "ClipboardItem" in window;

  const generar = async () => {
    if (!objetivo.current) return;
    setAbierto(true);
    setPng(null);
    setGenerando(true);
    const t = ahora();
    const contexto = [info?.panel, info?.seccion].filter(Boolean).join(" · ");
    const quien = user ? [user.name, user.surname].filter(Boolean).join(" ") || user.username : "";
    const pie = [
      ...(info?.filtros ?? []).filter(Boolean),
      ["Uso interno", quien && `Generado por ${quien}`, t.texto].filter(Boolean).join(" · "),
    ];
    setNombreArchivo(`${[info?.panel, info?.seccion, titulo].filter(Boolean).map((s) => slug(s!)).join("_")}_${t.iso}.png`);
    try {
      setPng(await generarPng(objetivo.current, { contexto, titulo }, pie));
    } catch (err) {
      console.error("Error generando la imagen:", err);
      toast.error("No se ha podido generar la imagen");
      setAbierto(false);
    } finally {
      setGenerando(false);
    }
  };

  const descargar = () => {
    if (!png) return;
    const a = document.createElement("a");
    a.href = png;
    a.download = nombreArchivo;
    a.click();
  };

  const copiar = async () => {
    if (!png) return;
    try {
      const blob = await (await fetch(png)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Imagen copiada: pégala en Teams o en un correo");
    } catch (err) {
      console.error("Error copiando la imagen:", err);
      toast.error("No se ha podido copiar la imagen; descárgala");
    }
  };

  return (
    <>
      <Button
        data-compartir-ocultar
        variant={conTexto ? "outline" : "ghost"}
        size={conTexto ? "sm" : "icon-sm"}
        className={cn(conTexto ? "gap-1.5" : "text-muted-foreground hover:text-foreground", className)}
        onClick={generar}
        title={`Compartir «${titulo}» como imagen`}
        aria-label={`Compartir «${titulo}» como imagen`}
      >
        <Share2 size={14} />
        {conTexto && "Compartir"}
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Compartir como imagen</DialogTitle>
            <DialogDescription>{titulo}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-48 items-center justify-center overflow-auto rounded-lg border border-border bg-muted/40 p-2">
            {generando || !png ? (
              <Loader2 className="animate-spin text-muted-foreground" size={20} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- imagen generada en el navegador (data URL)
              <img src={png} alt={`Vista previa: ${titulo}`} className="max-h-[60vh] w-auto max-w-full object-contain" />
            )}
          </div>
          {!puedeCopiar && (
            <p className="text-xs text-muted-foreground">Copiar al portapapeles solo funciona con HTTPS: de momento, descárgala y adjúntala.</p>
          )}
          <DialogFooter>
            {puedeCopiar && (
              <Button variant="outline" className="gap-1.5" onClick={copiar} disabled={!png}>
                <Copy size={14} /> Copiar
              </Button>
            )}
            <Button className="gap-1.5" onClick={descargar} disabled={!png}>
              <Download size={14} /> Descargar PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
