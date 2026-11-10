import { UnitIcon } from '../../components/art';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GENERAL_BY_ID, PROVINCE_BY_KEY, UNITS, formatDuration, type FormationDto, type UnitType } from '@cw/shared';
import { api } from '../../services/api';
import { useNow } from '../../hooks/useNow';

interface Props {
  campaignId: string;
  formations: FormationDto[];
  activeId: string | null;
  onMove: (formationId: string) => void;
  onFocus: (provinceKey: string) => void;
}

export function ArmiesPanel({ campaignId, formations, activeId, onMove, onFocus }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const stop = useMutation({
    mutationFn: (id: string) => api.stopFormation(campaignId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['state', campaignId] }),
  });

  const [manageId, setManageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splitCounts, setSplitCounts] = useState<Record<string, number>>({});
  const done = () => {
    setError(null);
    setManageId(null);
    setSplitCounts({});
    qc.invalidateQueries({ queryKey: ['state', campaignId] });
    qc.invalidateQueries({ queryKey: ['province', campaignId] });
  };
  const merge = useMutation({
    mutationFn: (v: { id: string; intoId: string }) => api.mergeFormation(campaignId, v.id, v.intoId),
    onSuccess: done,
    onError: (e) => setError((e as Error).message),
  });
  const split = useMutation({
    mutationFn: (v: { id: string; units: Partial<Record<UnitType, number>> }) => api.splitFormation(campaignId, v.id, v.units),
    onSuccess: done,
    onError: (e) => setError((e as Error).message),
  });

  const armies = formations.filter((f) => f.units.some((u) => u.count > 0));

  return (
    <div className="card">
      <h2>Armies ({armies.length})</h2>
      {armies.length === 0 && <p className="muted small">You have no armies yet.</p>}
      <ul className="list compact">
        {armies.map((f) => {
          const m = f.movement;
          const summary = f.units.map((u) => (
            <span key={u.unitType} className="unit-chip">
              <UnitIcon type={u.unitType} size={16} /> {u.count} {UNITS[u.unitType].name}
            </span>
          ));
          const finalKey = m ? (m.remainingKeys.at(-1) ?? m.toKey) : null;
          const nextIn = m ? (Date.parse(m.arrivesAt) - now) / 1000 : 0;
          return (
            <li key={f.id} className={activeId === f.id ? 'active' : ''}>
              <div>
                <button className="link" onClick={() => onFocus(m ? m.toKey : f.provinceKey)}>
                  {f.name}
                </button>
                <div className="muted small">{summary}</div>
                {f.generalId && <div className="small">General: {GENERAL_BY_ID[f.generalId]?.name}</div>}
                <div className="small">
                  {m
                    ? `→ ${PROVINCE_BY_KEY[finalKey!]?.name} · next stop in ${formatDuration(nextIn)}`
                    : `In ${PROVINCE_BY_KEY[f.provinceKey]?.name}`}
                </div>
              </div>
              <div className="row">
                <button onClick={() => onMove(f.id)}>{m ? 'Redirect' : 'Move'}</button>
                {!m && (
                  <button onClick={() => { setError(null); setSplitCounts({}); setManageId(manageId === f.id ? null : f.id); }}>
                    Manage
                  </button>
                )}
                {m && m.remainingKeys.length > 0 && (
                  <button disabled={stop.isPending} onClick={() => stop.mutate(f.id)}>
                    Stop
                  </button>
                )}
              </div>
              {manageId === f.id && !m && (
                <div className="manage">
                  {error && <p className="error small">{error}</p>}
                  <h3>Merge into</h3>
                  {armies.filter((o) => o.id !== f.id && !o.movement && o.provinceKey === f.provinceKey).length === 0 ? (
                    <p className="muted small">No other army in this province.</p>
                  ) : (
                    armies
                      .filter((o) => o.id !== f.id && !o.movement && o.provinceKey === f.provinceKey)
                      .map((o) => (
                        <button key={o.id} disabled={merge.isPending} onClick={() => merge.mutate({ id: f.id, intoId: o.id })}>
                          {o.name}
                        </button>
                      ))
                  )}
                  <h3>Split off a task force</h3>
                  {f.units.map((u) => (
                    <div key={u.unitType} className="row between small">
                      <span>
                        {UNITS[u.unitType].name} <span className="muted">(of {u.count})</span>
                      </span>
                      <input
                        className="unit-input"
                        type="number"
                        min={0}
                        max={u.count}
                        value={splitCounts[u.unitType] ?? 0}
                        onChange={(e) => setSplitCounts({ ...splitCounts, [u.unitType]: Number(e.target.value) })}
                      />
                    </div>
                  ))}
                  <button
                    disabled={split.isPending || !Object.values(splitCounts).some((n: number) => n > 0)}
                    onClick={() =>
                      split.mutate({
                        id: f.id,
                        units: Object.fromEntries(Object.entries(splitCounts).filter(([, n]: [string, number]) => n > 0)) as Partial<Record<UnitType, number>>,
                      })
                    }
                  >
                    Split
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
