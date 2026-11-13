import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { borderProvinceKeys, distributeToBorder, PROVINCE_BY_KEY, type FormationDto, type GameState } from '@cw/shared';
import { api } from '../../services/api';

interface Props {
  campaignId: string;
  state: GameState;
  formation: FormationDto;
  /** The country picked on the map or in the list (its border glows green). */
  target: string | null;
  onTarget: (id: string | null) => void;
  onClose: () => void;
}

/** Assign Front Line: choose the country whose border the army should hold. */
export function FrontPanel({ campaignId, state, formation, target, onTarget, onClose }: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const ownerByKey = useMemo(() => new Map(state.provinces.map((p) => [p.key, p.ownerCountryId])), [state.provinces]);
  const neighbours = useMemo(() => {
    const out: { id: string; name: string; border: number }[] = [];
    for (const c of state.countries) {
      if (c.id === state.me.countryId) continue;
      const keys = borderProvinceKeys(state.me.countryId, c.id, ownerByKey);
      if (keys.length) out.push({ id: c.id, name: c.name, border: keys.length });
    }
    return out.sort((a, b) => b.border - a.border);
  }, [state.countries, state.me.countryId, ownerByKey]);
  const plan = useMemo(() => {
    if (!target) return [];
    return distributeToBorder(borderProvinceKeys(state.me.countryId, target, ownerByKey), formation.units);
  }, [target, state.me.countryId, ownerByKey, formation.units]);
  const atWar = !!target && state.atWarWith.includes(target);
  const tName = state.countries.find((c) => c.id === target)?.name;
  const assign = useMutation({
    mutationFn: () => api.assignFront(campaignId, formation.id, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <div className="card move-panel">
      <div className="row between">
        <h2>Assign front line</h2>
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p>
        <strong>{formation.name}</strong>
      </p>
      <p className="muted small">
        Hover the border of a country on the map (it glows green) and click it, or pick it below. The army spreads out so each border province is covered; with fewer units than provinces the army
        covers as many as it can. When you are at war with that country the army advances and attacks by itself until the land is taken.
      </p>
      <ul className="list compact">
        {neighbours.length === 0 && <li className="muted small">Your land does not border another country.</li>}
        {neighbours.map((n) => (
          <li key={n.id}>
            <button className={target === n.id ? 'link active' : 'link'} onMouseEnter={() => onTarget(n.id)} onClick={() => onTarget(n.id)}>
              {n.name}
            </button>
            <span className="muted small">
              {n.border} border province{n.border === 1 ? '' : 's'}
              {state.atWarWith.includes(n.id) ? ' · at war' : ''}
            </span>
          </li>
        ))}
      </ul>
      {target && (
        <p className="small">
          Border with <strong>{tName}</strong>: the army will hold {plan.length} province{plan.length === 1 ? '' : 's'}
          {plan.length ? ` (${plan.slice(0, 4).map((p) => PROVINCE_BY_KEY[p.key]?.name).join(', ')}${plan.length > 4 ? ', ...' : ''})` : ''}.
          {atWar ? <span className="warn"> You are at war: it will attack at once.</span> : ' It will attack when war is declared.'}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      <button className="primary" disabled={!target || plan.length === 0 || assign.isPending} onClick={() => { setError(null); assign.mutate(); }}>
        Assign to border
      </button>
    </div>
  );
}
