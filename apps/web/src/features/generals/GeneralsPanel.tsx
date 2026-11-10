import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GENERALS,
  GENERAL_ACTIVE_SECONDS,
  GENERAL_BY_ID,
  GENERAL_CATEGORIES,
  GENERAL_COOLDOWN_SECONDS,
  GENERAL_FRAGMENTS_NEEDED,
  GENERAL_LEVEL_XP,
  abilityName,
  formatDuration,
  generalActivePercent,
  generalPassivePercent,
  scaleSeconds,
  xpToNextLevel,
  PROVINCE_BY_KEY,
  type GameState,
  type GeneralDto,
} from '@cw/shared';
import { api } from '../../services/api';
import { useNow } from '../../hooks/useNow';

export function GeneralsPanel({ campaignId, state }: { campaignId: string; state: GameState }) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['generals', campaignId], queryFn: () => api.generals(campaignId) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['generals', campaignId] });
    qc.invalidateQueries({ queryKey: ['state', campaignId] });
  };
  const run = <T,>(fn: () => Promise<T>, after?: (r: T) => void) =>
    fn().then(
      (r) => {
        setError(null);
        after?.(r);
        refresh();
      },
      (e) => setError((e as Error).message),
    );

  if (!q.data) return <div className="page-panel"><div className="card">Loading generals…</div></div>;
  const data = q.data;
  const byId = new Map<string, GeneralDto>(data.generals.map((g) => [g.generalId, g]));
  const gs = state.campaign.gameSpeed;
  const armies = state.formations.filter((f) => f.units.some((u) => u.count > 0));
  const dispatchLeft = data.nextDispatchAt ? (Date.parse(data.nextDispatchAt) - now) / 1000 : 0;

  return (
    <div className="page-panel generals-page">
      <div className="card">
        <h2>Generals</h2>
        <p className="small">
          Deployed {data.deployed} / {data.slots} slots. A general leads one army: his bonus applies in battles that army fights, only when it
          contains his kind of units. Levels come from battle experience. If his army is destroyed he is locked for 24 hours.
        </p>
        {error && <p className="error small">{error}</p>}
        {notice && <p className="win small">{notice}</p>}
        <div className="row">
          <button
            disabled={dispatchLeft > 0}
            onClick={() =>
              run(
                () => api.claimDispatch(campaignId),
                (r) =>
                  setNotice(
                    r.recruited
                      ? `${GENERAL_BY_ID[r.generalId].name} joined your command!`
                      : `Dispatch: a fragment for ${GENERAL_BY_ID[r.generalId].name} (${r.fragments}/${r.needed}).`,
                  ),
              )
            }
          >
            Claim free dispatch
          </button>
          <span className="muted small">
            {dispatchLeft > 0 ? `next in ${formatDuration(dispatchLeft)}` : 'Gives one recruitment fragment for a general you have not recruited. Fragments will also come from missions later.'}
          </span>
        </div>
      </div>

      {GENERAL_CATEGORIES.map((cat) => (
        <div className="card" key={cat.id}>
          <h3>{cat.name}</h3>
          <p className="muted small">{cat.blurb} Ability: {cat.ability}.</p>
          <div className="general-grid">
            {GENERALS.filter((g) => g.category === cat.id).map((def) => {
              const g = byId.get(def.id);
              if (!g) return null;
              const locked = g.lockedUntil && Date.parse(g.lockedUntil) > now ? (Date.parse(g.lockedUntil) - now) / 1000 : 0;
              const army = armies.find((a) => a.id === g.deployedFormationId);
              const active = g.abilityActiveUntil && Date.parse(g.abilityActiveUntil) > now ? (Date.parse(g.abilityActiveUntil) - now) / 1000 : 0;
              const cooldown = g.abilityReadyAt && Date.parse(g.abilityReadyAt) > now ? (Date.parse(g.abilityReadyAt) - now) / 1000 : 0;
              const need = GENERAL_FRAGMENTS_NEEDED[def.rarity];
              const toNext = xpToNextLevel(g.xp);
              const free = armies.filter((a) => !a.generalId || a.generalId === def.id);
              return (
                <div className={`general ${def.rarity} ${g.unlocked ? '' : 'unrecruited'}`} key={def.id}>
                  <div className="tech-head">
                    <strong>{def.name}</strong>
                    <span className={`rarity ${def.rarity}`}>{def.rarity}</span>
                  </div>
                  <div className="muted small">{def.nation} · {def.bio}</div>
                  {!g.unlocked ? (
                    <div className="small">Not recruited: {g.fragments} / {need} fragments</div>
                  ) : (
                    <>
                      <div className="small" title={`Base ${generalPassivePercent(def, 1)}%, +1% per level`}>
                        Level {g.level}/{GENERAL_LEVEL_XP.length} · +{generalPassivePercent(def, g.level)}% combat · {g.xp} XP
                        {toNext !== null ? ` (${toNext} to next level)` : ' (max)'}
                      </div>
                      <div className="small" title={`${abilityName(def)}: +${generalActivePercent(def)}% for ${formatDuration(scaleSeconds(GENERAL_ACTIVE_SECONDS, gs))}, cooldown ${formatDuration(scaleSeconds(GENERAL_COOLDOWN_SECONDS, gs))}`}>
                        {abilityName(def)}: +{generalActivePercent(def)}% for {formatDuration(scaleSeconds(GENERAL_ACTIVE_SECONDS, gs))}
                        {active > 0 ? ` · active, ${formatDuration(active)} left` : cooldown > 0 ? ` · ready in ${formatDuration(cooldown)}` : ' · ready'}
                      </div>
                      {locked > 0 ? (
                        <div className="warn small">Defeated. Recovering for {formatDuration(locked)}.</div>
                      ) : (
                        <div className="row">
                          <select
                            value={g.deployedFormationId ?? ''}
                            onChange={(e) =>
                              e.target.value
                                ? run(() => api.deployGeneral(campaignId, def.id, e.target.value))
                                : run(() => api.undeployGeneral(campaignId, def.id))
                            }
                          >
                            <option value="">Not deployed</option>
                            {free.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({PROVINCE_BY_KEY[a.movement?.toKey ?? a.provinceKey]?.name})
                              </option>
                            ))}
                          </select>
                          <button disabled={!army || cooldown > 0} onClick={() => run(() => api.activateGeneral(campaignId, def.id))}>
                            Use ability
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
