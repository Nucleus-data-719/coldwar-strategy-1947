import {
  BUILDINGS,
  PROVINCE_BY_KEY,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  formatDuration,
  type GameState,
  type Resources,
} from '@cw/shared';
import { useNow } from '../../hooks/useNow';

interface Props {
  state: GameState;
  balance: Resources;
  onSelectProvince: (key: string) => void;
}

export function EconomyPanel({ state, balance, onSelectProvince }: Props) {
  const now = useNow(1000);
  const mine = state.provinces.filter((p) => p.ownerCountryId === state.me.countryId);
  const queue = mine
    .flatMap((p) => p.buildings.filter((b) => b.status === 'constructing').map((b) => ({ p, b })))
    .sort((a, b) => new Date(a.b.completesAt).getTime() - new Date(b.b.completesAt).getTime());
  const completed = mine.flatMap((p) => p.buildings.filter((b) => b.status === 'complete').map((b) => ({ p, b })));
  const totalUnits = mine.reduce((s, p) => s + p.unitCount, 0);

  return (
    <div className="panel-page">
      <section className="card">
        <h2>Resources</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Balance</th>
              <th>Net per hour</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_KEYS.map((k) => (
              <tr key={k}>
                <td>{RESOURCE_LABELS[k]}</td>
                <td>{Math.floor(balance[k]).toLocaleString()}</td>
                <td className={state.resources.rates[k] < 0 ? 'neg' : 'pos'}>
                  {state.resources.rates[k] >= 0 ? '+' : ''}
                  {state.resources.rates[k].toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Net includes province production, local factory bonuses and unit upkeep ({totalUnits} units). Each infantry costs
          1 food and 0.5 money per hour.
        </p>
      </section>

      <section className="card">
        <h2>Construction queue</h2>
        {queue.length === 0 && <p className="muted">Nothing under construction.</p>}
        <ul className="list compact">
          {queue.map(({ p, b }) => (
            <li key={`${p.id}-${b.type}`}>
              <button className="link" onClick={() => onSelectProvince(p.key)}>
                {BUILDINGS[b.type].name} · {PROVINCE_BY_KEY[p.key]?.name}
              </button>
              <span className="muted small">{formatDuration((new Date(b.completesAt).getTime() - now) / 1000)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Buildings ({completed.length})</h2>
        {completed.length === 0 && <p className="muted">No completed buildings.</p>}
        <ul className="list compact">
          {completed.map(({ p, b }) => (
            <li key={`${p.id}-${b.type}`}>
              <button className="link" onClick={() => onSelectProvince(p.key)}>
                {PROVINCE_BY_KEY[p.key]?.name}
              </button>
              <span className="muted small">{BUILDINGS[b.type].name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
