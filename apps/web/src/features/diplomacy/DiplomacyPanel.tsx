import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALLIANCE_MIN_OPINION,
  ASSISTANCE_MAX_POINTS,
  ASSISTANCE_VALUE_PER_POINT,
  assistanceOpinion,
  formatDuration,
  type DiplomacyCountryDto,
  type GameState,
  type PartialResources,
} from '@cw/shared';
import { api } from '../../services/api';
import { useNow } from '../../hooks/useNow';
import { WarsPanel } from './WarsPanel';

const STAGE_LABEL: Record<string, string> = {
  war: 'At war',
  allied: 'Allied',
  friendly: 'Friendly',
  neutral: 'Neutral',
  unfriendly: 'Unfriendly',
  hostile: 'Hostile',
};

export function DiplomacyPanel({ campaignId, state }: { campaignId: string; state: GameState }) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aidFor, setAidFor] = useState<string | null>(null);
  const [gift, setGift] = useState<PartialResources>({ money: 1500 });

  const q = useQuery({ queryKey: ['diplomacy', campaignId], queryFn: () => api.diplomacy(campaignId) });
  const refresh = () => {
    for (const k of ['diplomacy', 'state', 'wars', 'notifications']) qc.invalidateQueries({ queryKey: [k, campaignId] });
  };
  const run = async <T,>(fn: () => Promise<T>, after?: (r: T) => void) => {
    try {
      const r = await fn();
      setError(null);
      after?.(r);
      refresh();
    } catch (e) {
      setNotice(null);
      setError((e as Error).message);
    }
  };

  if (!q.data) return <div className="page-panel"><div className="card">Loading diplomacy…</div></div>;
  const d = q.data;
  const incoming = d.countries.filter((c) => c.alliance === 'proposed_to_you');

  const rowButtons = (c: DiplomacyCountryDto) => {
    if (c.atWar) return <span className="chip">at war</span>;
    return (
      <div className="row">
        {c.alliance === 'none' && (
          <button onClick={() => run(() => api.proposeAlliance(campaignId, c.countryId), () => setNotice(c.aiControlled ? `${c.name} accepted.` : `Proposal sent to ${c.name}.`))}>
            Propose alliance
          </button>
        )}
        {c.alliance === 'proposed_by_you' && (
          <button onClick={() => run(() => api.breakAlliance(campaignId, c.countryId))}>Withdraw proposal</button>
        )}
        {c.alliance === 'proposed_to_you' && (
          <>
            <button onClick={() => run(() => api.respondAlliance(campaignId, c.countryId, true))}>Accept</button>
            <button onClick={() => run(() => api.respondAlliance(campaignId, c.countryId, false))}>Decline</button>
          </>
        )}
        {c.alliance === 'active' && (
          <button
            data-tip="Ends the pact. They will remember it (-30 opinion)."
            onClick={() => run(() => api.breakAlliance(campaignId, c.countryId))}
          >
            Break alliance
          </button>
        )}
        <button onClick={() => setAidFor(aidFor === c.countryId ? null : c.countryId)}>Send aid</button>
        {c.alliance !== 'active' && (
          <button className="danger" onClick={() => run(() => api.declareWar(campaignId, c.countryId))}>
            Declare war
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="page-panel">
      {d.calls.map((c) => (
        <div className="card call-banner" key={c.id}>
          <strong>Call to war:</strong> {c.defenderName}, your ally, was attacked by {c.aggressorName}.{' '}
          You join the war against {c.aggressorName} automatically in{' '}
          <strong>{formatDuration((Date.parse(c.joinsAt) - now) / 1000)}</strong>.
          <div className="row">
            <button className="danger" onClick={() => run(() => api.joinCall(campaignId, c.id))}>Join now</button>
            <button onClick={() => run(() => api.declineCall(campaignId, c.id))} data-tip="Ends the alliance with the attacked country (-40 opinion)">
              Decline (ends the alliance)
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <h2>Diplomacy</h2>
        <p className="small">
          Alliances {d.allianceCount} / {d.maxAlliances}. If an ally is attacked you get a call to war and join automatically after the
          mobilisation countdown, unless you decline. AI countries accept an alliance when they like you ({ALLIANCE_MIN_OPINION}+ opinion).
          Aid raises opinion by 1 per {ASSISTANCE_VALUE_PER_POINT} worth (max {ASSISTANCE_MAX_POINTS} per gift); declaring war lowers it by 60.
        </p>
        {error && <p className="error small">{error}</p>}
        {notice && <p className="win small">{notice}</p>}
        {incoming.length > 0 && <p className="warn small">Alliance offers from: {incoming.map((c) => c.name).join(', ')}</p>}
        <ul className="list compact">
          {d.countries.map((c) => (
            <li key={c.countryId} className="col">
              <div className="row between">
                <span>
                  <span className="swatch" style={{ background: c.color }} /> {c.name}{' '}
                  <span className="muted small">{c.aiControlled ? 'AI' : 'player'}</span>{' '}
                  <span className={`stage ${c.stage}`} data-tip="Stage comes from opinion, war and alliance">{STAGE_LABEL[c.stage]}</span>{' '}
                  <span className="muted small" data-tip="-100 to 100, same both ways">opinion {c.opinion}</span>
                </span>
                {rowButtons(c)}
              </div>
              {aidFor === c.countryId && (
                <div className="manage">
                  <div className="row small">
                    {(['money', 'food', 'oil', 'steel', 'electronics', 'rare', 'wood'] as const).map((k) => (
                      <label key={k}>
                        {k}{' '}
                        <input
                          className="unit-input"
                          type="number"
                          min={0}
                          value={gift[k] ?? 0}
                          onChange={(e) => setGift({ ...gift, [k]: Math.max(0, Math.floor(Number(e.target.value))) })}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="muted small">Opinion gain: +{assistanceOpinion(gift)}</div>
                  <button
                    onClick={() =>
                      run(
                        () => api.sendAid(campaignId, c.countryId, gift),
                        (r) => {
                          setNotice(`Aid sent. Opinion +${r.opinionGain}.`);
                          setAidFor(null);
                        },
                      )
                    }
                  >
                    Send
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <WarsPanel campaignId={campaignId} />
    </div>
  );
}
