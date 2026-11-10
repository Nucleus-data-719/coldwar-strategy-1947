import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RESEARCH_BRANCHES,
  RESEARCH_CANCEL_REFUND,
  RESEARCH_LAB_BONUS,
  RESEARCH_SPEED_CAP,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  TECHS,
  TECH_BY_ID,
  UNITS,
  UNIVERSITY_BONUS,
  canAfford,
  formatDuration,
  researchSeconds,
  type GameState,
  type PartialResources,
  type Resources,
  type TechDef,
} from '@cw/shared';
import { api } from '../../services/api';
import { useNow } from '../../hooks/useNow';

const costText = (cost: PartialResources) =>
  RESOURCE_KEYS.filter((k) => cost[k])
    .map((k) => `${cost[k]} ${RESOURCE_LABELS[k].toLowerCase()}`)
    .join(', ');

function effectText(t: TechDef): string {
  const parts: string[] = [];
  if (t.effect.unlock?.length) parts.push(`Unlocks ${t.effect.unlock.map((u) => UNITS[u].name).join(', ')}`);
  if (t.effect.productionPercent) parts.push(`+${t.effect.productionPercent}% production`);
  if (t.effect.combatPercent) parts.push(`+${t.effect.combatPercent}% combat strength`);
  if (t.effect.researchSpeedPercent) parts.push(`+${t.effect.researchSpeedPercent}% research speed`);
  return parts.join(' · ');
}

export function ResearchPanel({ campaignId, state, balance }: { campaignId: string; state: GameState; balance: Resources }) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const r = state.research;

  const done = new Set(r.done);
  const refresh = () => qc.invalidateQueries({ queryKey: ['state', campaignId] });
  const start = useMutation({
    mutationFn: (techId: string) => api.startResearch(campaignId, techId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelResearch(campaignId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });

  const activeTech = r.active ? TECH_BY_ID[r.active.techId] : null;
  const capped = r.rawSpeedPercent > r.speedPercent;

  return (
    <div className="page-panel research-page">
      <div className="card">
        <h2>Research</h2>
        <p className="small">
          Research speed <strong>+{r.speedPercent}%</strong>
          {capped && <span className="warn"> (cap reached, {r.rawSpeedPercent}% before the cap)</span>} ·{' '}
          <span data-tip={`Each laboratory adds ${RESEARCH_LAB_BONUS}%`}>{r.labs} laboratories</span>,{' '}
          <span data-tip={`Each university adds ${UNIVERSITY_BONUS}%`}>{r.universities} universities</span>
        </p>
        <p className="muted small">
          Laboratories give +{RESEARCH_LAB_BONUS}% and universities +{UNIVERSITY_BONUS}%. Speed is capped at +{RESEARCH_SPEED_CAP}% and
          is fixed when a project starts. Research cannot be bought: there is no way to skip the timer.
        </p>
        {error && <p className="error small">{error}</p>}
        {activeTech && r.active ? (
          <div className="research-active">
            <strong>{activeTech.name}</strong> — {formatDuration((new Date(r.active.completesAt).getTime() - now) / 1000)} left
            <button className="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel ({Math.round(RESEARCH_CANCEL_REFUND * 100)}% refund)
            </button>
          </div>
        ) : (
          <p className="muted small">No project running. Pick one below.</p>
        )}
      </div>

      <div className="research-grid">
        {RESEARCH_BRANCHES.map((b) => (
          <div className="card research-branch" key={b.id}>
            <h3>{b.name}</h3>
            <p className="muted small">{b.blurb}</p>
            {TECHS.filter((t) => t.branch === b.id)
              .sort((x, y) => x.tier - y.tier)
              .map((t) => {
                const isDone = done.has(t.id);
                const isActive = r.active?.techId === t.id;
                const missing = t.requires.filter((q) => !done.has(q));
                const secs = researchSeconds(t.baseSeconds, r.speedPercent, state.campaign.gameSpeed);
                const affordable = canAfford(balance, t.cost);
                let status = 'available';
                if (isDone) status = 'done';
                else if (isActive) status = 'active';
                else if (missing.length) status = 'locked';
                return (
                  <div className={`tech ${status}`} key={t.id}>
                    <div className="tech-head">
                      <strong>{t.name}</strong>
                      <span className="muted small">{t.era}</span>
                    </div>
                    <div className="small">{effectText(t)}</div>
                    <div className="muted small">{t.description}</div>
                    {isDone && <div className="win small">Researched</div>}
                    {isActive && <div className="small">In progress…</div>}
                    {!isDone && !isActive && missing.length > 0 && (
                      <div className="warn small">Requires {missing.map((m) => TECH_BY_ID[m]?.name ?? m).join(', ')}</div>
                    )}
                    {!isDone && !isActive && !missing.length && (
                      <>
                        <div className="small">
                          {costText(t.cost)} · {formatDuration(secs)}
                        </div>
                        <button
                          disabled={!!r.active || !affordable || start.isPending}
                          onClick={() => start.mutate(t.id)}
                          data-tip={r.active ? 'Another project is running' : !affordable ? 'Not enough resources' : ''}
                        >
                          Research
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
