"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSession } from "@/lib/db";
import { fmtDur, pad, todayKey } from "@/lib/utils";
import { kindMeta } from "@/lib/kinds";
import { Modal, NumField } from "./ui";
import GroupPicker from "./GroupPicker";

/**
 * Cargar tiempo a mano.
 *
 * El pomodoro sirve cuando estás sentado frente a la compu, pero al gimnasio no
 * te vas a llevar el timer y el partido no te avisa cuándo termina. Esto te deja
 * decir "hoy jugué una hora y media" después de que pasó, que es la única forma
 * realista de que ese tiempo quede medido.
 */

const QUICK = [15, 30, 45, 60, 90, 120];

const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function LogTime({ groups, open, onClose, onSaved, defaultGroupId = null }) {
  const parents = useMemo(
    () => groups.filter((g) => !g.parent_id && !g.archived),
    [groups]
  );

  const [groupId, setGroupId] = useState("");
  const [subId, setSubId] = useState("");
  const [dateKey, setDateKey] = useState(todayKey());
  const [endTime, setEndTime] = useState(nowHHMM());
  const [minutes, setMinutes] = useState(60);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const subs = useMemo(
    () => groups.filter((g) => g.parent_id === groupId && !g.archived),
    [groups, groupId]
  );

  // Cada vez que se ABRE arranca limpio y en la fecha/hora de ahora. Depende
  // solo de `open` a propósito: si un pomodoro termina mientras tenés el modal
  // abierto, la lista de grupos se recarga y no queremos que te borre lo escrito.
  const initial = useRef({ parents, defaultGroupId });
  initial.current = { parents, defaultGroupId };

  useEffect(() => {
    if (!open) return;
    const { parents: ps, defaultGroupId: def } = initial.current;
    setGroupId(def || ps[0]?.id || "");
    setSubId("");
    setDateKey(todayKey());
    setEndTime(nowHHMM());
    setMinutes(60);
    setNote("");
    setError("");
  }, [open]);

  const parent = parents.find((g) => g.id === groupId);
  const meta = kindMeta(parent);
  const mins = Math.max(0, Math.round(Number(minutes) || 0));

  const save = async () => {
    if (!groupId || mins < 1) return;
    setBusy(true);
    setError("");
    try {
      const [h, m] = (endTime || "00:00").split(":").map(Number);
      const [y, mo, d] = dateKey.split("-").map(Number);
      const end = new Date(y, mo - 1, d, h || 0, m || 0, 0, 0);
      const start = new Date(end.getTime() - mins * 60000);
      await createSession({
        group_id: subId || groupId,
        mode: "manual",
        started_at: start.toISOString(),
        ended_at: end.toISOString(),
        duration_seconds: mins * 60,
        note: note.trim() || null,
        local_date: dateKey,
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Registrar tiempo a mano">
      {parents.length === 0 ? (
        <p className="text-sm text-muted">Creá un grupo primero desde la pestaña Grupos.</p>
      ) : (
        <>
          <label className="label">¿En qué?</label>
          <GroupPicker
            groups={groups}
            value={groupId}
            onChange={(id) => {
              setGroupId(id);
              setSubId("");
            }}
          />
          <p className="mt-1.5 text-[11px] text-muted">
            {meta.emoji} {meta.label} · {meta.hint}
          </p>

          {subs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button onClick={() => setSubId("")} className={`chip ${!subId ? "chip-on" : ""}`}>
                General
              </button>
              {subs.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSubId(s.id)}
                  className={`chip ${subId === s.id ? "chip-on" : ""}`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: s.color }}
                  />
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <label className="label mt-4">¿Cuánto?</label>
          <NumField
            value={mins}
            onChange={setMinutes}
            min={5}
            max={1440}
            step={15}
            suffix="min"
          />
          <p className="mt-1.5 text-center text-xs text-muted">
            <span className="font-semibold text-ink">{fmtDur(mins * 60)}</span></p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setMinutes(q)}
                className={`chip text-[11px] ${mins === q ? "chip-on" : ""}`}
              >
                {q < 60 ? `${q}m` : q % 60 === 0 ? `${q / 60}h` : `${Math.floor(q / 60)}h ${q % 60}m`}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Día</label>
              <input
                type="date"
                className="field"
                max={todayKey()}
                value={dateKey}
                onChange={(e) => setDateKey(e.target.value || todayKey())}
              />
            </div>
            <div>
              <label className="label">Terminaste a las</label>
              <input
                type="time"
                className="field"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <label className="label mt-4">Nota (opcional)</label>
          <input
            className="field"
            placeholder="Ej: pierna y espalda / partida con los pibes"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />

          {error && <p className="mt-3 text-xs text-focus">Error al guardar: {error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="btn-quiet">
              Cancelar
            </button>
            <button onClick={save} disabled={busy || mins < 1 || !groupId} className="btn-primary">
              Registrar {fmtDur(mins * 60)}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
