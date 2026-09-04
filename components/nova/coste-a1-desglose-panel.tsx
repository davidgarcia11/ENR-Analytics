"use client";

// Panel de desglose (columna derecha de /coste-a1) — cuarto diseño de este
// panel. Los tres anteriores (Dialog con drill-down, pila de tarjetas con
// "peek" apilado, pestañas ANIDADAS una dentro de otra por cada nivel) se
// documentan en docs/coste-a1.md §4.2.2. Este sustituye las pestañas anidadas
// por UN selector PLANO ("tiene que ser laterales no?" quedó resuelto ahí,
// pero el usuario pidió ir más lejos: "quiero que arriba... salga el selector
// de los 11 y 10 que hay solo con el número de artículo, también salga el
// padre seleccionado, de manera predeterminada, y cuando se pulse a otro la
// descripción del componente se actualice y salga esa descripción, es 12 11 o
// 10 y si coincide o no").
//
// `nodosNavegables()` aplana TODO el árbol (el artículo final + cualquier
// componente con lista de materiales propia, a cualquier profundidad) en una
// sola lista — ya no hay pestañas dentro de pestañas: para entrar en un "11"
// que a su vez tiene su propio "10", se elige directamente en este mismo
// selector, no hace falta ir abriendo capas. Reutiliza `AnimatedTabs`
// (`tabs-08` de ShadcnSpace) tal cual, con el artículo final como primera
// pestaña (selección por defecto, al ser tabs[0]) y el resto con SOLO el
// código como etiqueta (nunca la descripción — con varios niveles aplanados
// los nombres largos no caben en una fila).
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedTabs, type AnimatedTabItem } from "@/components/shadcn-space/tabs/tabs-08";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/nova/ui/card";
import { ScrollArea } from "@/components/nova/ui/scroll-area";
import { Descuadre, DesviacionBadge, desviacionPct, estadoLocal, euros, type DespieceNode } from "./coste-a1-shared";

// Fila de un componente dentro de la lista de materiales del nodo
// seleccionado — calcada de `BillingPanel` (`components/shadcn-space/tabs/
// tabs-08.tsx`, demo real del bloque): título a la izquierda (+ una segunda
// línea con "Teórico X € · Real Y €" en vez de la fecha del original),
// importe a la derecha. Un componente con lista de materiales propia también
// aparece aquí igual que uno sin ella — para entrar en el suyo se usa el
// selector de arriba, no hace falta duplicarlo como pestaña otra vez.
function FilaHoja({ node }: { node: DespieceNode }) {
  const desviacion = desviacionPct(node);
  return (
    <li className="flex items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground" title={`${node.codigo}${node.descripcion ? " — " + node.descripcion : ""}`}>
          {node.descripcion || "(sin descripción)"}
        </p>
        {/* Código visible, no solo en el `title` (tooltip al pasar el ratón)
            — pedido explícito: "en el desglose tiene que aparecer el número
            de artículo de todos". Mismo patrón que la tabla (código en mono
            debajo de la descripción). */}
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{node.codigo}</span> · Teórico {node.costeA1 != null ? euros(node.costeA1) : "—"} · Real {node.costeReal != null ? euros(node.costeReal) : "—"}
        </p>
      </div>
      {desviacion != null && <DesviacionBadge pct={desviacion} tono="xs" />}
    </li>
  );
}

// Contenido de una pestaña del selector plano: descripción + tipo (12/11/10,
// el código crudo de F4101.IMSRP1 — pedido explícito: "que salga esa
// descripción, es 12 11 o 10") + `Descuadre` (¿coincide o no? mismo criterio
// de siempre, `estadoLocal` — solo mira los hijos DIRECTOS de este nodo) y,
// debajo, su propia lista de materiales (sus hijos directos, sin distinguir
// hoja/rama — ver nota de `FilaHoja`).
//
// `px-3`/`gap-2` en vez de `px-4`/`gap-4` — pedido explícito: "quiero que el
// selector se quede igual, pero el resto de lo que sale de los componentes se
// adapte más al ancho del componente". A diferencia del selector (que solo
// tiene el margen exterior del panel, `p-4` en `CosteA1DesglosePanel`), estas
// tarjetas suman SU PROPIO padding interno encima de ese margen — quitarles
// aire propio (aquí y en `FilaHoja`) es lo único que les da más ancho de
// verdad para el texto sin tocar el selector ni el margen del panel.
function DetalleNodo({ node }: { node: DespieceNode }) {
  const estado = estadoLocal(node);
  const desviacion = desviacionPct(node);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="rounded-2xl border border-border bg-card px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={node.codigo}>
              {node.descripcion || "(sin descripción)"}
            </p>
            {/* Código visible, no solo en el `title` — mismo pedido que
                FilaHoja: "en el desglose tiene que aparecer el número de
                artículo de todos", el nodo seleccionado en el selector
                (el "padre") incluido. */}
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{node.codigo}</span> · Tipo {node.tipoCod || "—"} · {node.tipo}
            </p>
          </div>
          {node.costeA1 != null && <Descuadre estado={estado} tono="xs" />}
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          Teórico <span className="font-semibold tabular-nums text-foreground">{node.costeA1 != null ? euros(node.costeA1) : "—"}</span>
          {" · "}Real <span className="font-semibold tabular-nums text-foreground">{node.costeReal != null ? euros(node.costeReal) : "—"}</span>
          {/* Desviación con fondo, también aquí — pedido explícito: "cuando
              seleccionas un componente que sale como 'padre'... ahí quiero
              que salga también la desviación y con fondo". Antes esta
              tarjeta no mostraba desviación en absoluto (solo Teórico/Real),
              a diferencia de la cabecera del panel (§ más abajo). */}
          {desviacion != null && (
            <>
              {" · "}Desv. <DesviacionBadge pct={desviacion} tono="xs" />
            </>
          )}
        </p>
      </div>
      {node.children.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card px-3 py-1">
          <ul className="flex flex-col divide-y divide-border">
            {node.children.map((c, i) => (
              <FilaHoja key={`${c.codigo}-${i}`} node={c} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">Sin componentes propios.</p>
      )}
    </div>
  );
}

// Aplana el árbol completo a la lista de nodos "navegables" desde el
// selector: el artículo final (raíz) siempre el primero — así queda
// seleccionado por defecto, al ser `tabs[0]` — y, en orden de aparición en el
// árbol, cualquier componente con lista de materiales propia (children.length
// > 0), a cualquier profundidad. Las hojas (materia prima, envases...) no
// entran aquí — se ven dentro de `DetalleNodo`, en la lista de materiales del
// nodo seleccionado, no como opción propia del selector.
//
// `key` va aparte de `node.codigo`: el mismo componente puede reutilizarse en
// varias recetas hermanas de un mismo árbol (p. ej. una base compartida entre
// dos variedades de un "surtido") y aparecer varias veces al aplanar — bug
// real visto con datos reales (SURTIDO TORTILLAS, código "1010100001" repetido
// 3 veces). Como `AnimatedTabs` usa `value` para saber qué pestaña está activa,
// dos pestañas con el mismo `value` (el código) colisionaban: siempre "ganaba"
// la primera de las dos, la otra quedaba inalcanzable. `key` incluye la
// posición en el árbol para ser único SIEMPRE, aunque el código se repita — la
// etiqueta visible (`label`) sigue siendo solo `node.codigo`.
interface NodoNavegable { key: string; node: DespieceNode }

function nodosNavegables(raiz: DespieceNode): NodoNavegable[] {
  const resultado: NodoNavegable[] = [{ key: raiz.codigo, node: raiz }];
  function visitar(n: DespieceNode, prefijo: string) {
    n.children.forEach((hijo, i) => {
      if (hijo.children.length > 0) {
        const key = `${prefijo}.${i}.${hijo.codigo}`;
        resultado.push({ key, node: hijo });
        visitar(hijo, key);
      }
    });
  }
  visitar(raiz, raiz.codigo);
  return resultado;
}

export default function CosteA1DesglosePanel({ node }: { node: DespieceNode | null }) {
  const selectorRef = useRef<HTMLDivElement>(null);
  // ¿Hay más códigos hacia cada lado de los que se ven ahora mismo? Pedido
  // explícito tras el arreglo anterior: con el selector ya acotado a su
  // scroll propio, no había forma de saber "cuántos hay" ni de llegar a ellos
  // con el ratón (`overflow-x-auto` sin más solo responde a rueda con Shift o
  // gesto táctil, nunca a un simple arrastre de ratón, y sin un scrollbar
  // visible tampoco había pista de que hubiera más). Dos flechas, mostradas
  // solo cuando hace falta, cubren ambos casos a la vez.
  const [puedeIzq, setPuedeIzq] = useState(false);
  const [puedeDer, setPuedeDer] = useState(false);
  // Alto real de la fila de pestañas (medido, no adivinado) — las flechas lo
  // usan como su propia altura en vez de una fija (`size-7`): con
  // `items-start` solas, al ser más bajas que la fila (28px vs. lo que mida
  // `tabs-08` de verdad con su padding), su CENTRO quedaba más arriba que el
  // centro de las píldoras — se veían "descentradas" ("no está bien centrada
  // la flecha"). Igualando alturas, su `items-center` interno ya las centra
  // solas respecto a la fila real, sea cual sea esa altura.
  const [altoSelector, setAltoSelector] = useState<number | null>(null);

  const listaSelector = () => selectorRef.current?.querySelector<HTMLElement>('[data-slot="tabs-list"]') ?? null;

  const actualizarFlechas = () => {
    const lista = listaSelector();
    if (!lista) { setPuedeIzq(false); setPuedeDer(false); return; }
    setPuedeIzq(lista.scrollLeft > 1);
    setPuedeDer(lista.scrollLeft < lista.scrollWidth - lista.clientWidth - 1);
    setAltoSelector(lista.getBoundingClientRect().height);
  };

  // Con muchos códigos, el selector nace con scroll horizontal ya desplazado
  // (comprobado con `agent-browser`: scrollLeft = scrollWidth - ancho, es
  // decir, al máximo — la raíz, primera pestaña y seleccionada por defecto,
  // queda fuera de la vista). No es un `.scrollLeft = ...` de nuestro código
  // ni de `tabs-08` (no se detecta ninguna escritura interceptando el setter),
  // así que es el propio navegador ajustando el scroll durante el montaje —
  // se corrige forzándolo de vuelta a 0 justo después, y de paso se calcula
  // el estado inicial de las flechas (y su alto) y se engancha el listener de
  // scroll (se reengancha en cada montaje del selector, ver `key={node.codigo}`
  // abajo).
  useLayoutEffect(() => {
    const lista = listaSelector();
    if (!lista) return;
    lista.scrollLeft = 0;
    actualizarFlechas();
    lista.addEventListener("scroll", actualizarFlechas, { passive: true });
    return () => lista.removeEventListener("scroll", actualizarFlechas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.codigo]);

  const desplazar = (direccion: 1 | -1) => {
    listaSelector()?.scrollBy({ left: direccion * 180, behavior: "smooth" });
  };

  if (!node) {
    return (
      <Card className="flex min-h-[32rem] items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Selecciona un artículo final de la tabla para ver su desglose.
      </Card>
    );
  }

  const tabs: AnimatedTabItem[] = nodosNavegables(node).map(({ key, node: n }) => ({
    value: key,
    label: n.codigo,
    content: <DetalleNodo node={n} />,
  }));

  // Resumen del artículo final en conjunto (la raíz, no el nodo elegido en el
  // selector de abajo) — pedido explícito: "arriba del todo en la cabecera...
  // que salga también si coincide o no, teórico - real, desviación". Mismos
  // campos que ve la fila de la tabla de la izquierda para este artículo
  // (Coste Teórico/Producción/Coste Real/Desviación) más el estado real de
  // verificación (`Descuadre`, `estadoLocal`) — la cabecera es la única parte
  // del panel que NO cambia con la pestaña activa del selector, así que
  // sirve de ancla estable con este resumen siempre a la vista.
  const estadoRaiz = estadoLocal(node);
  const desviacionRaiz = desviacionPct(node);

  // Dos bugs reales con árboles anchos (p. ej. un "surtido" con muchas
  // variedades, cada una con su propia lista de materiales — confirmado con
  // SURTIDO TORTILLAS, 7 códigos):
  // 1) `tabs-08` mide el selector con "sm:w-fit" (crece con el contenido) SIN
  //    techo — como "sm:" depende del ancho de la VENTANA, no del panel, en
  //    cualquier escritorio normal siempre gana "w-fit" sobre el "w-full"
  //    base, así que con muchos códigos el selector se hacía más ancho que el
  //    panel. Al no tener el selector su propio límite, era el `ScrollArea`
  //    de todo el panel el que terminaba desbordado y scrolleable en
  //    horizontal — pero moviéndolo se iba TODO el contenido (detalle + lista
  //    de materiales) a la vez, dejando la tarjeta de detalle fuera de la
  //    vista. `max-w-full` limita el selector al ancho del panel: por debajo
  //    de ese ancho se ve compacto igual que antes, por encima activa SU
  //    PROPIO scroll horizontal (`overflow-x-auto`, ya presente en
  //    `tabs-08`) sin arrastrar nada más.
  // 2) Con el selector ya acotado y con scroll propio, la raíz (primera
  //    pestaña, seleccionada por defecto) seguía sin verse — bug clásico de
  //    CSS: el `TabsList` compartido (`components/nova/ui/tabs.tsx`) lleva
  //    `justify-center`, y un flex centrado que desborda su contenedor con
  //    scroll dejaba la mitad inicial del contenido inalcanzable (scrollLeft
  //    nace ya desplazado, y ni 0 ni el máximo llegan a mostrarla — comprobado
  //    con `agent-browser`: cambiar `scrollLeft` no movía qué códigos se
  //    veían). `justify-start` en vez de centrado dentro de este panel
  //    (irrelevante para el caso sin desbordar, con pocos códigos el `w-fit`
  //    ya envuelve el contenido exacto) hace que el desbordamiento crezca
  //    siempre hacia la derecha — la raíz, al ser el primer elemento, queda
  //    visible desde el principio sin ningún ajuste de scroll manual.
  // `pr-16`: hueco reservado para las DOS flechas juntas, ancladas a la
  // derecha (ver más abajo) — dejaron de flanquear cada una un lado
  // (`pl-9 pr-9`) porque eso, aparte del bug ya corregido del ancho del
  // detalle, hacía que el propio selector tuviera un tamaño distinto según
  // cuántos códigos hubiera: `sm:w-fit` (de `tabs-08`, sin tocar) encoge la
  // lista al contenido en cuanto no hace falta scroll, así que con pocos
  // códigos la caja quedaba estrecha y descentrada, y con muchos se
  // estiraba a todo el ancho — pedido explícito: "quiero que el selector
  // tenga siempre el mismo tamaño tenga uno o más artículos". `sm:w-full`
  // (sustituye a `sm:w-fit`) fuerza SIEMPRE el ancho completo del panel,
  // tenga 1 o 7 códigos — las píldoras ocupan lo que necesiten por la
  // izquierda, el hueco de las flechas quede fijo a la derecha.
  const selectorClassName = "sm:w-full max-w-full justify-start [overflow-anchor:none] pr-16";

  return (
    <Card className="p-0">
      {/* Sin el subtítulo "Desglose del coste declarado." — pedido explícito,
          quitado para que quepa todo en la misma altura que la cabecera de la
          tabla (`px-6 pt-6` en `CosteA1Table`, 76px — ver ronda anterior).
          Con el resumen (Teórico/Real/Desviación + `Descuadre`) reemplazando
          esa línea en vez de sumarse a ella, título + resumen vuelven a medir
          lo mismo que título + subtítulo de la tabla. */}
      <CardHeader className="gap-1 px-4 pt-6">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <CardTitle className="truncate text-lg font-medium text-foreground">{node.descripcion || "(sin descripción)"}</CardTitle>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.codigo}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            Teórico <span className="font-semibold tabular-nums text-foreground">{node.costeA1 != null ? euros(node.costeA1) : "—"}</span>
            {" · "}Real <span className="font-semibold tabular-nums text-foreground">{node.costeReal != null ? euros(node.costeReal) : "—"}</span>
          </p>
          {/* Desv. con fondo (mismo `DesviacionBadge` que la tabla y el
              desglose de componentes, ver coste-a1-shared.tsx) — pedido
              explícito: "arriba en la descripción que sale la desviación
              también, que salga con el fondo rojo igual". Fuera de la `<p>`
              que trunca (Teórico/Real) para que la píldora nunca quede
              recortada por el `truncate` si el nombre del artículo empuja el
              contenido. */}
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {desviacionRaiz != null ? (
              <>
                Desv. <DesviacionBadge pct={desviacionRaiz} tono="xs" />
              </>
            ) : (
              <>Desv. —</>
            )}
            {node.costeA1 != null && <Descuadre estado={estadoRaiz} tono="xs" />}
          </div>
        </div>
      </CardHeader>
      {/* Misma altura que la tabla (h-[32rem]) — con scroll propio. El
          selector queda arriba del todo, a la altura de la fila de cabeceras
          de columna de la tabla de la izquierda ("Artículo | Coste Teórico |
          ..."), en vez de enterrado dentro de una tarjeta por nivel. */}
      <CardContent className="border-t border-border p-0">
        <ScrollArea className="h-[32rem]">
          {/* p-4 en vez de p-6 — pedido explícito: el ancho exterior del
              panel no se toca (grid 2/3-1/3 de siempre), el sitio de más para
              el selector/lista de materiales sale de achicar el margen
              INTERNO entre la tarjeta y su contenido, no de ensanchar la
              tarjeta por fuera. */}
          <div className="p-4">
            {/* key={node.codigo}: al cambiar de artículo final seleccionado en
                la tabla, se remonta el selector — vuelve a arrancar en la raíz
                del nuevo árbol en vez de arrastrar la pestaña activa.

                Flechas JUNTAS, ancladas arriba a la derecha (`absolute`,
                `top-0 right-0`) — pedido explícito: "las flechas están las
                dos a un lado, no sé si es mejor así" → sí, mejor así: un
                único control de dos botones se lee mejor que dos flechas
                sueltas en extremos opuestos, y de paso el selector ya no
                necesita reservar hueco a los DOS lados de la fila de
                píldoras (`pl-9 pr-9` de la ronda anterior), solo a la derecha
                (`pr-16` en `selectorClassName`, arriba) — con `sm:w-full`
                forzando siempre el ancho completo del panel, el selector mide
                igual tenga 1 o 7 códigos. Bug real corregido en la ronda
                anterior sigue aplicando igual: como hermanas de flex de todo
                el bloque `<AnimatedTabs>` (selector + `DetalleNodo`, que ese
                componente renderiza juntos sin poder separarlos), unas
                flechas flex-siblings le robarían ancho también al detalle de
                abajo — por eso siguen en `absolute`, no vuelven a ser hijas
                de flex de nada. Siguen SIEMPRE presentes (nunca se montan/
                desmontan) — pedido explícito original: "deberían estar
                siempre arriba... para que lo de abajo no cambie de tamaño" —
                `invisible` en vez de no renderizar cuando no hace falta ese
                lado.

                Alto medido (`altoSelector`, del propio
                `[data-slot="tabs-list"]`) en vez de fijo — con la misma
                altura que la fila real de `tabs-08`, el `items-center`
                interno de cada botón centra su icono respecto a las píldoras
                de verdad, sea cual sea esa altura (bug real ya corregido en
                una ronda anterior, ver docs/coste-a1.md §4.2.1bis). */}
            <div className="relative">
              <div ref={selectorRef}>
                <AnimatedTabs key={node.codigo} tabs={tabs} listClassName={selectorClassName} />
              </div>
              <div className="absolute right-0 top-0 z-10 flex gap-1">
                <button
                  type="button"
                  onClick={() => desplazar(-1)}
                  disabled={!puedeIzq}
                  aria-label="Ver códigos anteriores"
                  style={altoSelector != null ? { height: altoSelector } : undefined}
                  className={cn(
                    "flex w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    !puedeIzq && "invisible",
                  )}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => desplazar(1)}
                  disabled={!puedeDer}
                  aria-label="Ver más códigos"
                  style={altoSelector != null ? { height: altoSelector } : undefined}
                  className={cn(
                    "flex w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    !puedeDer && "invisible",
                  )}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
