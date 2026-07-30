"use client";

import { useMemo, useState } from "react";
import { createGroup, updateGroup, deleteGroup } from "@/lib/db";
import { PALETTE, fmtDur } from "@/lib/utils";
import { Modal, Bar, Empty } from "./ui";

export default function GroupsManager({ groups, weekByGroup, onChange }) {
  const [editing, setEditing] = useState(null); // {mode:'new'|'edit', parentId, group}
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [goal, setGoal] = useState(0); // horas por semana
  const [busy, setBusy] = useState(false);

  const parents = useMemo(() => groups.filter((g) => !g.parent_id), [groups]);
  const childrenOf = (id) => groups.filter((g) => g.parent_id === id);

  const openNew = (parentId = null) => {
    setEditing({ mode: "new", parentId });
    setName("");
    setColor(parentId ? groups.find((g) => g.id === parentId)?.color || PALETTE[0] : PALETTE[parents.length % PALETTE.length]);
    setGoal(0);
  };

  const openEdit = (g) => {
    setEditing({ mode: "edit", group: g, parentId: g.parent_id });
    setName(g.name);
    setColor(g.color);
    setGoal(Math.round(((g.weekly_goal_minutes || 0) / 60) * 10) / 10);
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        color,
        weekly_goal_minutes: Math.round((Number(goal) || 0) * 60),
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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Grupos y materias</h2>
          <p className="text-sm text-muted">
            Organizá en qué categorías medís tu tiempo y ponete metas semanales.
          </p>
        </div>
        <button onClick={() => openNew(null)} className="btn-primary shrink-0">
          + Grupo
        </button>
      </div>

      {parents.length === 0 ? (
        <Empty>Todavía no tenés grupos. Creá el primero.</Empty>
      ) : (
        <div className="space-y-4">
          {parents.map((p) => {
            const kids = childrenOf(p.id);
            const sec = weekByGroup?.[p.id] || 0;
            const goalMin = p.weekly_goal_minutes || 0;
            return (
              <div key={p.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ background: p.color, boxShadow: `0 0 12px ${p.color}88` }}
                    />
                    <div>
                      <p className="font-bold">{p.name}</p>
                      <p className="text-xs text-muted">
                        {kids.length} subgrupos · {fmtDur(sec)} esta semana
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => openEdit(p)} className="btn-quiet px-2.5 py-1.5 text-xs">
                      Editar
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="btn-quiet px-2.5 py-1.5 text-xs hover:text-focus"
                    >
                      Borrar
                    </button>
                  </div>
                </div>

                {goalMin > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-muted">
                      <span>Meta semanal</span>
                      <span className="tnum">
                        {fmtDur(sec)} / {Math.round((goalMin / 60) * 10) / 10}h ·{" "}
                        {Math.round((sec / 60 / goalMin) * 100)}%
                      </span>
                    </div>
                    <Bar pct={(sec / 60 / goalMin) * 100} color={p.color} />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line/60 pt-4">
                  {kids.map((k) => (
                    <div key={k.id} className="group inline-flex items-center">
                      <button
                        onClick={() => openEdit(k)}
                        className="chip rounded-r-none border-r-0 hover:text-ink"
                      >
                        {k.name}
                        <span className="tnum ml-1 text-[10px] text-muted/70">
                          {fmtDur(weekByGroup?.[k.id] || 0)}
                        </span>
                      </button>
                      <button
                        onClick={() => remove(k)}
                        className="chip rounded-l-none px-2 text-muted hover:text-focus"
                        title="Borrar"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => openNew(p.id)}
                    className="chip border-dashed hover:border-accent/60 hover:text-ink"
                  >
                    + Subgrupo
                  </button>
                </div>
              </div>
            );
          })}
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
          placeholder="Ej: Física II"
          onKeyDown={(e) => e.key === "Enter" && save()}
        />

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
            <label className="label mt-4">Meta semanal (horas · 0 = sin meta)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              className="field"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
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
