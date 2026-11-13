import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PROVINCE_BY_KEY, UNITS, type FormationDto, type UnitType } from '@cw/shared';
import { api } from '../../services/api';

interface Props {
  campaignId: string;
  formation: FormationDto;
  onClose: () => void;
  /** Called with the id of the new army so it can be selected and given orders. */
  onDone: (newId: string) => void;
}

/** Splits some of an army's units off into a new army in the same place. */
export function SplitPanel({ campaignId, formation, onClose, onDone }: Props) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(formation.units.map((u) => [u.unitType, 0])));
  const [error, setError] = useState<string | null>(null);
  const chosen = Object.entries(counts).filter(([, n]) => n > 0);
  const total = formation.units.reduce((s, u) => s + u.count, 0);
  const picked = chosen.reduce((s, [, n]) => s + n, 0);
  const split = useMutation({
    mutationFn: () => api.splitFormation(campaignId, formation.id, Object.fromEntries(chosen) as Partial<Record<UnitType, number>>) as Promise<{ ok: true; formationId?: string }>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      onDone(r.formationId ?? formation.id);
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <div className="card move-panel">
      <div className="row between">
        <h2>Split army</h2>
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p>
        <strong>{formation.name}</strong> <span className="muted small">in {PROVINCE_BY_KEY[formation.provinceKey]?.name}</span>
      </p>
      <h3>Units for the new army</h3>
      <ul className="list compact">
        {formation.units.map((u) => (
          <li key={u.unitType}>
            <span>
              {UNITS[u.unitType].name} <span className="muted small">(of {u.count})</span>
            </span>
            <input
              className="unit-input"
              type="number"
              min={0}
              max={u.count}
              value={counts[u.unitType] ?? 0}
              onChange={(e) => setCounts({ ...counts, [u.unitType]: Math.max(0, Math.min(u.count, Number(e.target.value))) })}
            />
          </li>
        ))}
      </ul>
      <p className="muted small">The new army stays here. Select it afterwards to send it somewhere. It will not rejoin the old army until it moves away and back.</p>
      {error && <p className="error small">{error}</p>}
      <button className="primary" disabled={picked === 0 || picked >= total || split.isPending} onClick={() => { setError(null); split.mutate(); }}>
        Split off {picked} unit{picked === 1 ? '' : 's'}
      </button>
    </div>
  );
}
