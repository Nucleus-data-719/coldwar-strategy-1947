import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UNITS, type BattleReportDto, type BattleSideReport } from '@cw/shared';
import { api } from '../../services/api';

const army = (units: { unitType: keyof typeof UNITS; count: number }[]) =>
  units.length === 0 ? 'none' : units.map((u) => `${u.count} ${UNITS[u.unitType].name}`).join(', ');

function Side({ title, side }: { title: string; side: BattleSideReport }) {
  return (
    <div className="battle-side">
      <strong>
        {title}: {side.countryName}
      </strong>
      <div className="muted small">{side.formations.join(', ') || 'No forces'}</div>
      <div className="small">Before: {army(side.before)}</div>
      <div className="small">After: {army(side.after)}</div>
    </div>
  );
}

function Report({ r }: { r: BattleReportDto }) {
  return (
    <div className="battle-report">
      <div className="battle-sides">
        <Side title="Attacker" side={r.attacker} />
        <Side title="Defender" side={r.defender} />
      </div>
      <h3>Why it went this way</h3>
      <ul className="plain small">
        {r.summary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {r.rounds.length > 0 && (
        <>
          <h3>Strength remaining, round by round</h3>
          <div className="rounds small">
            {r.rounds.map((x) => (
              <div key={x.round} className="round">
                <span className="muted">#{x.round}</span> <span className="att">{x.attackerPct}%</span> ·{' '}
                <span className="def">{x.defenderPct}%</span>
              </div>
            ))}
          </div>
          <p className="muted small">Attacker % · Defender %</p>
        </>
      )}
    </div>
  );
}

export const verdict = (r: BattleReportDto, myId: string) => {
  const attackerWon = r.outcome !== 'defender_held';
  const iAttacked = r.attacker.countryId === myId;
  return attackerWon === iAttacked ? 'Victory' : 'Defeat';
};

export function BattlesPanel({ campaignId, myCountryId }: { campaignId: string; myCountryId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['battles', campaignId], queryFn: () => api.battles(campaignId) });

  return (
    <div className="card">
      <h2>Battle reports</h2>
      {list.data?.length === 0 && <p className="muted small">No battles yet.</p>}
      <ul className="list compact">
        {list.data?.map((r) => {
          const v = verdict(r, myCountryId);
          return (
            <li key={r.id} className="col">
              <button className="link left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className={v === 'Victory' ? 'win' : 'lose'}>{v}</span> · {r.provinceName}{' '}
                <span className="muted small">
                  {r.attacker.countryName} → {r.defender.countryName} · {new Date(r.createdAt).toLocaleTimeString()}
                </span>
              </button>
              {open === r.id && <Report r={r} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
