import { useEffect, useMemo, useState } from 'react';
import type { GameState } from '@cw/shared';
import { Icon } from '../../components/Icon';
import { playSfx } from '../../services/audio';

/**
 * First-session tutorial: "Orders from HQ". Every step is detected from the real game state,
 * so players are never asked to press a "next" button; the step ticks itself when they do it.
 * Progress is remembered per campaign in the browser.
 */

export type StepId = 'select' | 'build' | 'recruit' | 'move' | 'war' | 'capture';

interface StepDef {
  id: StepId;
  title: string;
  how: string;
  /** Label of the "Show me" button, if the game can lead the player there. */
  show?: string;
}

const STEPS: StepDef[] = [
  {
    id: 'select',
    title: 'Look at your capital',
    how: 'Click a province on the map. Your provinces have a gold outline. The panel on the right shows what it produces and what it holds.',
    show: 'Select my capital',
  },
  {
    id: 'build',
    title: 'Build a Recruitment Center',
    how: 'In the Province panel, scroll to "Construct" and press Build next to Recruitment Center. It costs money and takes a little time. Once built, that province trains infantry by itself.',
    show: 'Take me there',
  },
  {
    id: 'recruit',
    title: 'Train soldiers',
    how: 'In a province with a Recruitment Center (or a Military Factory), find "Production", pick Infantry, set a number and press Order. New units appear in the province when the timer finishes.',
  },
  {
    id: 'move',
    title: 'Send an army',
    how: 'Click an army figure on the map to select it, then right-click a province to send it there (or press "Move / Attack…" and click the destination). Land forces follow the roads. The route is previewed; confirm and watch the army march along the dashed line.',
  },
  {
    id: 'war',
    title: 'Declare war on a neighbour',
    how: 'Open the Diplomacy tab and declare war on a country whose border you share. Weaker neighbours (AI-run ones) are the easiest first targets. Allies of your target may join against you.',
    show: 'Open Diplomacy',
  },
  {
    id: 'capture',
    title: 'Capture an enemy province',
    how: 'Move an army into an enemy province. The battle resolves in rounds; if you win and no defenders remain, the province is yours. A captured province produces nothing for a while.',
  },
];

interface Saved {
  dismissed: boolean;
  collapsed: boolean;
  done: StepId[];
  startUnits: number;
  startProvinces: number;
}

const key = (campaignId: string) => `cw1947.tutorial.${campaignId}`;

function load(campaignId: string): Saved | null {
  try {
    const raw = localStorage.getItem(key(campaignId));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** True when the player closed the tutorial earlier, so it should not pop up again by itself. */
export function isTutorialDismissed(campaignId: string): boolean {
  return load(campaignId)?.dismissed ?? false;
}

function save(campaignId: string, s: Saved) {
  try {
    localStorage.setItem(key(campaignId), JSON.stringify(s));
  } catch {
    /* storage blocked: the tutorial just won't be remembered */
  }
}

interface Props {
  campaignId: string;
  state: GameState;
  /** Set by the game page once the player has clicked any province. */
  hasSelected: boolean;
  /** Lets the "Show me" buttons lead the player to the right place. */
  onShow: (id: StepId) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Tutorial({ campaignId, state, hasSelected, onShow, open, onOpenChange }: Props) {
  const mineProvinces = useMemo(() => state.provinces.filter((p) => p.ownerCountryId === state.me.countryId), [state.provinces, state.me.countryId]);
  const unitTotal = mineProvinces.reduce((s, p) => s + p.unitCount, 0);

  const [saved, setSaved] = useState<Saved>(() => {
    const prev = load(campaignId);
    if (prev) return prev;
    // First time in this campaign: remember the starting point so "recruit" and "capture" can be measured.
    const fresh: Saved = {
      dismissed: false,
      collapsed: typeof window !== 'undefined' && window.innerWidth < 860,
      done: [],
      startUnits: unitTotal,
      startProvinces: mineProvinces.length,
    };
    save(campaignId, fresh);
    return fresh;
  });

  const detected: Record<StepId, boolean> = {
    select: hasSelected,
    build: mineProvinces.some((p) => p.buildings.some((b) => b.type === 'recruitment_center' || b.type === 'military_factory')),
    recruit: unitTotal > saved.startUnits,
    move: state.formations.some((f) => f.movement !== null),
    war: state.atWarWith.length > 0,
    capture: mineProvinces.length > saved.startProvinces,
  };

  // Steps stay ticked once done, even if the situation later changes.
  useEffect(() => {
    const newly = STEPS.filter((s) => detected[s.id] && !saved.done.includes(s.id)).map((s) => s.id);
    if (newly.length === 0) return;
    const next = { ...saved, done: [...saved.done, ...newly] };
    setSaved(next);
    save(campaignId, next);
    playSfx('research');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected.select, detected.build, detected.recruit, detected.move, detected.war, detected.capture]);

  // Open/closed state of the card lives with the game page, so the top-bar help button can reopen it.
  useEffect(() => {
    if (saved.dismissed && open) {
      const next = { ...saved, dismissed: false };
      setSaved(next);
      save(campaignId, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = new Set(saved.done);
  const current = STEPS.find((s) => !done.has(s.id));
  const finished = !current;
  const hidden = saved.dismissed || !open;
  if (hidden) return null;

  const setCollapsed = (collapsed: boolean) => {
    const next = { ...saved, collapsed };
    setSaved(next);
    save(campaignId, next);
  };
  const dismiss = () => {
    const next = { ...saved, dismissed: true };
    setSaved(next);
    save(campaignId, next);
    onOpenChange(false);
  };

  return (
    <aside className={saved.collapsed ? 'tutorial collapsed' : 'tutorial'} aria-label="Tutorial">
      <header className="tutorial-head">
        <button className="tutorial-title ghost" onClick={() => setCollapsed(!saved.collapsed)}>
          <Icon name="star" size={16} /> Orders from HQ
          <span className="tutorial-count">
            {done.size}/{STEPS.length}
          </span>
        </button>
        <button className="ghost icon small" aria-label="Close tutorial" onClick={dismiss}>
          <Icon name="close" size={16} />
        </button>
      </header>
      {!saved.collapsed && (
        <div className="tutorial-body">
          <div className="bar">
            <i style={{ width: `${(done.size / STEPS.length) * 100}%` }} />
          </div>
          <ol className="tutorial-steps">
            {STEPS.map((s) => {
              const isDone = done.has(s.id);
              const isCurrent = current?.id === s.id;
              return (
                <li key={s.id} className={isDone ? 'done' : isCurrent ? 'current' : ''}>
                  <span className="step-mark">{isDone ? <Icon name="check" size={14} /> : STEPS.indexOf(s) + 1}</span>
                  <div>
                    <strong>{s.title}</strong>
                    {isCurrent && (
                      <>
                        <p className="small">{s.how}</p>
                        {s.show && (
                          <button className="btn-sm primary" onClick={() => onShow(s.id)}>
                            {s.show}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {finished && (
            <p className="small pos">
              You have captured a province. From here: research new technology, recruit generals, make allies. Re-open this guide any time with the ? button.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
