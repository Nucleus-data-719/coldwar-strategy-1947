import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GENERAL_BY_ID, PROVINCE_BY_KEY, UNITS, formatDuration, type FormationDto } from '@cw/shared';
import { api } from '../../services/api';
import { UnitIcon } from '../../components/art';
import { useNow } from '../../hooks/useNow';

interface Props {
  campaignId: string;
  formation: FormationDto;
  /** Enters destination-picking mode. */
  onOrder: () => void;
  onDeselect: () => void;
}

/** The card for an army selected on the map: what it is, where it is, and what it can be ordered to do. */
export function ArmyCard({ campaignId, formation: f, onOrder, onDeselect }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const m = f.movement;
  const stop = useMutation({
    mutationFn: () => api.stopFormation(campaignId, f.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['state', campaignId] }),
  });
  const finalKey = m ? (m.remainingKeys.at(-1) ?? m.toKey) : null;
  const nextIn = m ? Math.max(0, (Date.parse(m.arrivesAt) - now) / 1000) : 0;
  const total = f.units.reduce((s, u) => s + u.count, 0);

  return (
    <div className="card army-card">
      <div className="row between">
        <h2>{f.name}</h2>
        <button className="ghost icon small" aria-label="Deselect army" onClick={onDeselect}>
          ✕
        </button>
      </div>
      <p className="small muted">
        {m
          ? `Marching to ${PROVINCE_BY_KEY[finalKey!]?.name}. Next stop in ${formatDuration(nextIn)}.`
          : `Standing in ${PROVINCE_BY_KEY[f.provinceKey]?.name}.`}
      </p>
      <ul className="list compact">
        {f.units.map((u) => (
          <li key={u.unitType}>
            <span className="with-icon">
              <UnitIcon type={u.unitType} size={20} /> {UNITS[u.unitType].name}
            </span>
            <strong>{u.count}</strong>
          </li>
        ))}
      </ul>
      {f.generalId && <p className="small">General: {GENERAL_BY_ID[f.generalId]?.name}</p>}
      <div className="row army-orders">
        <button className="primary" onClick={onOrder} disabled={total === 0}>
          {m ? 'New orders…' : 'Move / Attack…'}
        </button>
        {m && (
          <button className="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
            Cancel orders
          </button>
        )}
      </div>
      <p className="muted small">Tip: with this army selected, right-click a province on the map to order it there. Land forces follow the roads.</p>
    </div>
  );
}
