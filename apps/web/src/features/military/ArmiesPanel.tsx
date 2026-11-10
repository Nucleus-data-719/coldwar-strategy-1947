import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PROVINCE_BY_KEY, UNITS, formatDuration, type FormationDto } from '@cw/shared';
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

  const armies = formations.filter((f) => f.units.some((u) => u.count > 0));

  return (
    <div className="card">
      <h2>Armies ({armies.length})</h2>
      {armies.length === 0 && <p className="muted small">You have no armies yet.</p>}
      <ul className="list compact">
        {armies.map((f) => {
          const m = f.movement;
          const summary = f.units.map((u) => `${u.count} ${UNITS[u.unitType].name}`).join(', ');
          const finalKey = m ? (m.remainingKeys.at(-1) ?? m.toKey) : null;
          const nextIn = m ? (Date.parse(m.arrivesAt) - now) / 1000 : 0;
          return (
            <li key={f.id} className={activeId === f.id ? 'active' : ''}>
              <div>
                <button className="link" onClick={() => onFocus(m ? m.toKey : f.provinceKey)}>
                  {f.name}
                </button>
                <div className="muted small">{summary}</div>
                <div className="small">
                  {m
                    ? `→ ${PROVINCE_BY_KEY[finalKey!]?.name} · next stop in ${formatDuration(nextIn)}`
                    : `In ${PROVINCE_BY_KEY[f.provinceKey]?.name}`}
                </div>
              </div>
              <div className="row">
                <button onClick={() => onMove(f.id)}>{m ? 'Redirect' : 'Move'}</button>
                {m && m.remainingKeys.length > 0 && (
                  <button disabled={stop.isPending} onClick={() => stop.mutate(f.id)}>
                    Stop
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
