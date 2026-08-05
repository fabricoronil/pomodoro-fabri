"use client";

import { useMemo, useState } from "react";
import { createGroup, updateGroup, deleteGroup, missingGroupFeatures } from "@/lib/db";
import { PALETTE, fmtDur } from "@/lib/utils";
import { KIND_LIST, KIND_ORDER, KINDS, goalTypeOf, kindOf } from "@/lib/kinds";
import { Modal, Empty, GoalLine, NumField } from "./ui";

/** horas (lo que se escribe) <-> minutos (lo que se guarda) */
const toHoursInput = (min) => Math.round(((min || 0) / 60) * 100) / 100;
const toMinutes = (h) => Math.round((Number(h) || 0) * 60);

export default function GroupsManager({ groups, weekByGroup, todayByGroup, onChange }) {
  const [editing, setEditing] = useState(null); // {mode:'new'|'edit', parentId, group}
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [kind, setKind] = useState("productivo");
  const [goalType, setGoalType] = useState("meta");
  const [weekGoal, setWeekGoal] = useState(0); // horas por semana
  const [dayGoal, setDayGoal] = useState(0); // horas por día
  const [busy, setBusy] = useState(false);

  const parents = useMemo(() => groups.filter((g) => !g.parent_id), [groups]);
  const childrenOf = (id) => groups.filter((g) => g.parent_id === id);

  // si la base todavía no tiene estas columnas, el tipo y el objetivo no se
  // guardan (se descartan para no tumbar el resto del grupo). Mejor decirlo.
  const missingCols = useMemo(() => missingGroupFeatures(), [groups]);
  const noKinds = missingCols.includes("kind");

  // agrupados por tipo de actividad, en orden fijo
  const sections = useMemo(
    () =>
      KIND_ORDER.map((k) => ({
        kind: KINDS[k],
        list: parents.filter((g) => kindOf(g) === k),
      })).filter((s) => s.list.length),
    [parents]
  );

  const openNew = (parentId = null) => {
    const parent = parentId ? groups.find((g) => g.id === parentId) : null;
    const k = parent ? kindOf(parent) : "productivo";
    setEditing({ mode: "new", parentId });
    setName("");
    setColor(
      parent ? parent.color || PALETTE[0] : PALETTE[parents.length % PALETTE.length]
    );
    setKind(k);
    setGoalType(KINDS[k].defaultGoalType);
    setWeekGoal(0);
    setDayGoal(0);
  };

  const openEdit = (g) => {
    setEditing({ mode: "edit", group: g, parentId: g.parent_id });
    setName(g.name);
    setColor(g.color);
    setKind(kindOf(g));
    setGoalType(goalTypeOf(g));
    setWeekGoal(toHoursInput(g.weekly_goal_minutes));
    setDayGoal(toHoursInput(g.daily_goal_minutes));
  };

  /** Al cambiar el tipo, el objetivo se acomoda solo (despeje → límite) */
  const pickKind = (k) => {
    setKind(k);
    setGoalType(KINDS[k].defaultGoalType);
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const isRoot = !editing.parentId;
      const payload = {
        name: name.trim(),
        color,
        ...(isRoot
          ? {
              kind,
              goal_type: goalType,
              weekly_goal_minutes: toMinutes(weekGoal),
              daily_goal_minutes: toMinutes(dayGoal),
            }
          : {}),
      };
      if (editing.mode === "new") {
        await createGroup({
          ...payload,
          parent_id: editing.parentId,
          sort_order: editing.parentId ? childrenOf(editing.parentId).length : parents.length,
        });
      } else {
        await updateGroup(editing.group.id, payload);
      }
      setEditing(null);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g) => {
    const kids = childrenOf(g.id).length;
    const msg = kids
      ? `Borrar "${g.name}", sus ${kids} subgrupos y todas sus sesiones?`
      : `Borrar "${g.name}" y todas sus sesiones?`;
    if (!confirm(msg)) return;
    await deleteGroup(g.id);
    await onChange();
  };

  const limitMode = goalType === "limite";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Grupos y actividades</h2>
          <p className="text-sm text-muted">
            Organizá en qué le metés el tiempo. Ponete metas para lo que querés
            empujar y límites para lo que querés tener a raya.
          </p>
        </div>
        <button onClick={() => openNew(null)} className="btn-primary shrink-0">
          + Grupo
        </button>
      </div>

      {noKinds && (
        <div className="mb-5 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <p className="font-semibold text-warn">Falta una migración en la base</p>
          <p className="mt-1 text-muted">
            Tu Supabase todavía no tiene las columnas{" "}
            <span className="tnum">{missingCols.join(", ")}</span>, así que el tipo
            de actividad y los objetivos no se guardan. Corré{" "}
            <span className="tnum">
              supabase/migrations/20260731120000_group_kinds_and_limits.sql
            </span>{" "}
            en el SQL Editor y recargá.
          </p>
        </div>
      )}

      {parents.length === 0 ? (
        <Empty>Todavía no tenés grupos. Creá el primero.</Empty>
      ) : (
        <div className="space-y-7">
          {sections.map((s) => (
            <div key={s.kind.id}>
              <div className="mb-2.5 flex items-baseline gap-2">
                <span className="text-sm">{s.kind.emoji}</span>
                <p className="text-sm font-bold">{s.kind.label}</p>
                <span className="text-xs text-muted">{s.kind.hint}</span>
              </div>
              <div className="space-y-4">
                {s.list.map((p) => (
                  <GroupCard
                    key={p.id}
                    group={p}
                    kids={childrenOf(p.id)}
                    weekSec={weekByGroup?.[p.id] || 0}
                    todaySec={todayByGroup?.[p.id] || 0}
                    weekByGroup={weekByGroup}
                    onEdit={openEdit}
                    onRemove={remove}
                    onNewSub={() => openNew(p.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing?.mode === "new"
            ? editing?.parentId
              ? "Nuevo subgrupo"
              : "Nuevo grupo"
            : "Editar"
        }
      >
        <label className="label">Nombre</label>
        <input
          autoFocus
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Matemática, Gimnasio, PlayStation…"
          onKeyDown={(e) => e.key === "Enter" && save()}
        />

        {!editing?.parentId && (
          <>
            <label className="label mt-4">Tipo de actividad</label>
            {noKinds && (
              <p className="mb-2 text-[11px] leading-snug text-warn">
                Ojo: falta la migración, esto no se va a guardar.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              {KIND_LIST.map((k) => (
                <button
                  key={k.id}
                  onClick={() => pickKind(k.id)}
                  className={`rounded-xl border p-3 text-left transition ${
                    kind === k.id
                      ? "border-accent/70 bg-accent/10"
                      : "border-line bg-surface2/40 hover:bg-surface2"
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {k.emoji} {k.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{k.hint}</p>
                </button>
              ))}
            </div>
          </>
        )}

        <label className="label mt-4">Color</label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-lg border-2 transition ${
                color === c ? "border-ink scale-110" : "border-transparent"
              }`}
              style={{ background: c }}
            />
          ))}
        </div>

        {!editing?.parentId && (
          <>
            <label className="label mt-4">Objetivo</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setGoalType("meta")}
                className={`rounded-xl border p-3 text-left transition ${
                  !limitMode
                    ? "border-rest/70 bg-rest/10"
                    : "border-line bg-surface2/40 hover:bg-surface2"
                }`}
              >
                <p className="text-sm font-semibold">↑ Meta</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">
                  Mínimo que querés cumplir
                </p>
              </button>
              <button
                onClick={() => setGoalType("limite")}
                className={`rounded-xl border p-3 text-left transition ${
                  limitMode
                    ? "border-focus/70 bg-focus/10"
                    : "border-line bg-surface2/40 hover:bg-surface2"
                }`}
              >
                <p className="text-sm font-semibold">↓ Límite</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">
                  Máximo que no querés pasar
                </p>
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">
                  {limitMode ? "Límite" : "Meta"} semanal
                </label>
                <NumField
                  value={weekGoal}
                  onChange={setWeekGoal}
                  min={0}
                  max={168}
                  step={0.5}
                  suffix="h"
                />
              </div>
              <div>
                <label className="label">{limitMode ? "Límite" : "Meta"} diaria</label>
                <NumField
                  value={dayGoal}
                  onChange={setDayGoal}
                  min={0}
                  max={24}
                  step={0.5}
                  suffix="h"
                />
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              0 = sin objetivo. Podés poner solo uno de los dos.
              {limitMode && " Cuando te pasás, la app te lo marca en rojo."}
            </p>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="btn-quiet">
            Cancelar
          </button>
          <button onClick={save} disabled={busy || !name.trim()} className="btn-primary">
            Guardar
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ TARJETA */

function GroupCard({
  group: p,
  kids,
  weekSec,
  todaySec,
  weekByGroup,
  onEdit,
  onRemove,
  onNewSub,
}) {
  const type = goalTypeOf(p);
  const weekMin = p.weekly_goal_minutes || 0;
  const dayMin = p.daily_goal_minutes || 0;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full"
            style={{ background: p.color, boxShadow: `0 0 12px ${p.color}88` }}
          />
          <div>
            <p className="font-bold">{p.name}</p>
            <p className="text-xs text-muted">
              {kids.length} subgrupos · {fmtDur(weekSec)} esta semana
              {todaySec > 0 && ` · ${fmtDur(todaySec)} hoy`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={() => onEdit(p)} className="btn-quiet px-2.5 py-1.5 text-xs">
            Editar
          </button>
          <button
            onClick={() => onRemove(p)}
            className="btn-quiet px-2.5 py-1.5 text-xs hover:text-focus"
          >
            Borrar
          </button>
        </div>
      </div>

      {(weekMin > 0 || dayMin > 0) && (
        <div className="mt-4 space-y-3">
          {dayMin > 0 && (
            <GoalLine label="Hoy" sec={todaySec} goalMin={dayMin} type={type} />
          )}
          {weekMin > 0 && (
            <GoalLine label="Esta semana" sec={weekSec} goalMin={weekMin} type={type} />
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line/60 pt-4">
        {kids.map((k) => (
          <div key={k.id} className="group inline-flex items-center">
            <button
              onClick={() => onEdit(k)}
              className="chip rounded-r-none border-r-0 hover:text-ink"
            >
              {k.name}
              <span className="tnum ml-1 text-[10px] text-muted/70">
                {fmtDur(weekByGroup?.[k.id] || 0)}
              </span>
            </button>
            <button
              onClick={() => onRemove(k)}
              className="chip rounded-l-none px-2 text-muted hover:text-focus"
              title="Borrar"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={onNewSub}
          className="chip border-dashed hover:border-accent/60 hover:text-ink"
        >
          + Subgrupo
        </button>
      </div>
    </div>
  );
}
