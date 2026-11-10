import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

export function WarsPanel({ campaignId }: { campaignId: string }) {
  const wars = useQuery({ queryKey: ['wars', campaignId], queryFn: () => api.wars(campaignId) });

  return (
    <>
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
        <p className="muted small">Peace treaties are not in the game yet: a war lasts until the end of the campaign.</p>
      </div>
    </>
  );
}
