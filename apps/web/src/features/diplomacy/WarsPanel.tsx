import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GameState } from '@cw/shared';
import { api } from '../../services/api';

export function WarsPanel({ campaignId, state }: { campaignId: string; state: GameState }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const wars = useQuery({ queryKey: ['wars', campaignId], queryFn: () => api.wars(campaignId) });

  const declare = useMutation({
    mutationFn: (countryId: string) => api.declareWar(campaignId, countryId),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['wars', campaignId] });
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const atWar = new Set(state.atWarWith);
  const others = state.countries.filter((c) => c.id !== state.me.countryId);

  return (
    <div className="page-panel">
      <div className="card">
        <h2>Wars</h2>
        {wars.data?.length === 0 && <p className="muted small">You are at peace with everyone.</p>}
        <ul className="list compact">
          {wars.data?.map((w) => (
            <li key={w.id}>
              <span>
                ⚔ {w.enemyName}{' '}
                <span className="muted small">{w.declaredByYou ? 'you declared' : 'declared on you'}</span>
              </span>
              <span className="muted small">{new Date(w.declaredAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Peace treaties arrive with the diplomacy update. For now a war lasts until the end of the campaign.</p>
      </div>

      <div className="card">
        <h2>Declare war</h2>
        <p className="muted small">
          War starts immediately. Your armies may then enter that country's provinces and fight for them; they can also
          attack you.
        </p>
        {error && <p className="error small">{error}</p>}
        <ul className="list compact">
          {others.map((c) => (
            <li key={c.id}>
              <span>
                <span className="swatch" style={{ background: c.color }} /> {c.name}{' '}
                <span className="muted small">
                  {c.provinceCount} provinces · {c.aiControlled ? 'AI' : 'player'}
                </span>
              </span>
              {atWar.has(c.id) ? (
                <span className="chip">at war</span>
              ) : (
                <button className="danger" disabled={declare.isPending} onClick={() => declare.mutate(c.id)}>
                  Declare war
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
