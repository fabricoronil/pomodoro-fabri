"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KINDS, KIND_ORDER, kindMeta, kindOf } from "@/lib/kinds";
import { fmtDur } from "@/lib/utils";

/**
 * Selector de grupo.
 *
 * Reemplaza al `<select>` nativo, que en el desplegable pierde todo: no puede
 * mostrar el color del grupo, ni separar por tipo de actividad, ni respetar el
 * tema (el navegador lo pinta con los colores del sistema operativo).
 *
 * La lista se dibuja en un portal sobre <body>, con posición fija calculada a
 * partir del botón. No es capricho:
 *   - `.card` usa backdrop-blur, y eso crea un contexto de apilado por tarjeta:
 *     un panel `absolute` adentro de una tarjeta queda TAPADO por las tarjetas
 *     que vienen después, por más z-index que le pongas.
 *   - dentro del modal de "cargar tiempo" (que tiene overflow-y-auto) un panel
 *     absolute queda recortado por el borde del modal.
 * Colgando de <body> no hay nada que lo tape ni que lo corte, y como la altura
 * se recorta al hueco real de la pantalla, lo que sobra se scrollea adentro de
 * la lista.
 */

const GAP = 8; // separación entre el botón y la lista
const MARGIN = 12; // aire mínimo contra el borde de la pantalla
const MAX_H = 340;

export default function GroupPicker({
  groups,
  value,
  onChange,
  timeByGroup,
  timeLabel = "",
  placeholder = "Elegí un grupo",
  onOpenChange,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null); // {left, width, top|bottom, maxH}
  const btnRef = useRef(null);
  const listRef = useRef(null);

  const parents = useMemo(
    () => groups.filter((g) => !g.parent_id && !g.archived),
    [groups]
  );

  // agrupados por tipo, en orden fijo; la lista plana es para el teclado
  const sections = useMemo(
    () =>
      KIND_ORDER.map((k) => ({
        kind: KINDS[k],
        list: parents.filter((g) => kindOf(g) === k),
      })).filter((s) => s.list.length),
    [parents]
  );
  const flat = useMemo(() => sections.flatMap((s) => s.list), [sections]);

  const selected = parents.find((g) => g.id === value) || null;

  const pick = (id) => {
    onChange(id);
    setOpen(false);
  };

  // el que nos usa puede necesitar saberlo (p. ej. para apagar los atajos de
  // teclado del timer mientras la lista está desplegada)
  useEffect(() => {
    onOpenChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // al abrir, el resaltado arranca en el que está elegido
  useEffect(() => {
    if (!open) return;
    const i = flat.findIndex((g) => g.id === value);
    setActive(i >= 0 ? i : 0);
  }, [open, flat, value]);

  /**
   * Dónde y de qué alto va la lista.
   *
   * Se ancla al botón: si abajo no entra cómoda y arriba hay más lugar, se abre
   * hacia arriba. En los dos casos el alto se recorta al hueco disponible, así
   * nunca queda un pedazo colgando fuera de la pantalla (que era justamente lo
   * que no se podía scrollear).
   */
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < 200 && above > below;
    // sin piso mínimo a propósito: es preferible una lista bajita con scroll
    // propio antes que una alta que se salga de la pantalla
    const space = Math.min(MAX_H, Math.max(0, up ? above : below));
    const next = {
      left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - r.width - MARGIN)),
      width: r.width,
      up,
      offset: up ? window.innerHeight - r.top + GAP : r.bottom + GAP,
      maxH: space,
    };
    setPos((p) =>
      p &&
      p.left === next.left &&
      p.width === next.width &&
      p.up === next.up &&
      p.offset === next.offset &&
      p.maxH === next.maxH
        ? p
        : next
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    window.addEventListener("resize", place);
    // `true`: también si scrollea un contenedor de adentro (el modal)
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // teclado: mover el resaltado, elegir y cerrar
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // que no cierre además el modal de atrás
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => {
          const n = flat.length;
          if (!n) return 0;
          return (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        });
      }
      if (e.key === "Enter" && flat[active]) {
        e.preventDefault();
        pick(flat[active].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, active]);

  // que el resaltado del teclado nunca quede fuera de la vista
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  if (!parents.length) {
    return <div className="field text-muted">Creá un grupo primero</div>;
  }

  const meta = selected ? kindMeta(selected) : null;

  // `pos` recién existe después de medir (useLayoutEffect, antes de pintar):
  // hasta entonces no hay panel que dibujar.
  const panel = pos && (
    <>
      {/* click afuera para cerrar */}
      <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
      <div
        ref={listRef}
        role="listbox"
        className="card animate-pop fixed z-[91] overflow-y-auto overscroll-contain p-1.5"
        style={{
          left: pos.left,
          width: pos.width,
          [pos.up ? "bottom" : "top"]: pos.offset,
          maxHeight: pos.maxH,
          boxShadow: "0 24px 60px -20px rgb(0 0 0 / .75)",
        }}
      >
        {sections.map((s, si) => (
          <div key={s.kind.id}>
            {sections.length > 1 && (
              <p
                className={`px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[.12em] text-muted ${
                  si ? "mt-2 border-t border-line/60 pt-2" : "pt-1"
                }`}
              >
                {s.kind.emoji} {s.kind.label}
              </p>
            )}
            {s.list.map((g) => {
              const on = g.id === value;
              const isActive = flat[active]?.id === g.id;
              const sec = timeByGroup?.[g.id] || 0;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-active={isActive}
                  onMouseEnter={() => setActive(flat.findIndex((x) => x.id === g.id))}
                  onClick={() => pick(g.id)}
                  className={`opt ${on ? "opt-on" : ""} ${
                    isActive && !on ? "bg-surface2 text-ink" : ""
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: g.color,
                      boxShadow: on ? `0 0 0 3px ${g.color}33` : undefined,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                  {sec > 0 && (
                    <span className="tnum shrink-0 text-[11px] text-muted">
                      {fmtDur(sec)}
                      {timeLabel && <span className="ml-1 opacity-70">{timeLabel}</span>}
                    </span>
                  )}
                  {on && <span className="shrink-0 text-accent">✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`field flex items-center justify-between gap-3 text-left ${
          open ? "border-accent/70" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {selected ? (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: selected.color,
                  boxShadow: `0 0 0 3px ${selected.color}22`,
                }}
              />
              <span className="truncate font-medium">
                {meta.emoji} {selected.name}
              </span>
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <Chevron open={open} />
      </button>

      {open && panel && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform duration-200 ${
        open ? "-rotate-180" : ""
      }`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
