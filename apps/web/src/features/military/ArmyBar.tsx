import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GENERAL_BY_ID,
  PROVINCE_BY_KEY,
  UNITS,
  canOccupyLand,
  formatDuration,
  formationSpeed,
  isNavalFormation,
  minelayerCount,
  planRoute,
  type FormationDto,
  type GameState,
} from '@cw/shared';
import { api } from '../../services/api';
import { UnitIcon } from '../../components/art';
import { useNow } from '../../hooks/useNow';
import { DelayDialog } from './DelayDialog';

export type OrderKind = 'move' | 'attack' | 'waypoint';

interface Props {
  campaignId: string;
  state: GameState;
  formation: FormationDto;
  /** The order being planned right now, if any (highlights its button). */
  active: { kind: OrderKind; naval: boolean } | null;
  onOrder: (kind: OrderKind, naval: boolean) => void;
  /** Opens the split panel / the assign-front-line mode. */
  onSplit: () => void;
  onFront: () => void;
  onClose: () => void;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

function Btn({ label, tone, on, disabled, onClick, tip, children }: { label: string; tone: 'green' | 'red' | 'purple' | 'blue'; on?: boolean; disabled?: boolean; onClick: () => void; tip?: string; children: ReactNode }) {
  return (
    <button className={`ob-btn ${tone}${on ? ' on' : ''}`} disabled={disabled} onClick={onClick} data-tip={tip} data-tip-pos="above">
      <span className="ob-ic">{children}</span>
      <span className="ob-label">{label}</span>
    </button>
  );
}

const I = {
  move: <path d="M5 5l7 7-7 7M12 5l7 7-7 7" />,
  attack: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M12 8a4 4 0 100 8 4 4 0 000-8z" />,
  waypoint: <path d="M6 21V4l10 4-10 4M15 17h6M18 14v6" />,
  delay: <path d="M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2" />,
  cancel: <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM6 6l12 12" />,
  mine: <path d="M12 7a5 5 0 100 10 5 5 0 000-10zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />,
  split: <path d="M12 20v-8M12 12L5 5M12 12l7-7M5 5v4M5 5h4M19 5v4M19 5h-4" />,
  front: <path d="M3 18l4-9 4 6 4-10 3 7 3-2M3 21h18" />,
  sail: <path d="M3 17h18l-3 4H6zM12 3v12M12 4l6 9h-6" />,
};
const Ic = ({ d }: { d: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

/** The order bar and army panel shown at the bottom of the map when an army is selected. */
export function ArmyBar({ campaignId, state, formation: f, active, onOrder, onSplit, onFront, onClose }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [delayOpen, setDelayOpen] = useState(false);
  const m = f.movement;
  const sea = f.sea ?? null;
  const voyage = sea?.voyage ?? null;
  const onPatrol = !!f.patrol;
  const hasShips = f.units.some((u) => UNITS[u.unitType].category === 'naval');
  const hasLand = f.units.some((u) => UNITS[u.unitType].category !== 'naval');
  const layers = minelayerCount(f.units);
  const busy = !!m || !!voyage || onPatrol;
  const held = !!m?.holdUntil && Date.parse(m.holdUntil) > now;
  const refresh = () => qc.invalidateQueries({ queryKey: ['state', campaignId] });
  const onFrontLine = !!f.frontCountryId;
  const stop = useMutation({
    mutationFn: () => (!m && !voyage && !onPatrol && onFrontLine ? api.assignFront(campaignId, f.id, null) : api.stopFormation(campaignId, f.id)),
    onSuccess: refresh,
  });
  const unitTotal = f.units.reduce((s, u) => s + u.count, 0);
  const mines = useMutation({ mutationFn: () => api.layMines(campaignId, f.id), onSuccess: refresh });

  const ownerByKey = useMemo(() => new Map(state.provinces.map((p) => [p.key, p.ownerCountryId])), [state.provinces]);
  const railwayKeys = useMemo(
    () => new Set(state.provinces.filter((p) => p.buildings.some((b) => b.type === 'railway' && b.status === 'complete' && b.damage < 50)).map((p) => p.key)),
    [state.provinces],
  );
  const speed = formationSpeed(f.units);
  const finalKey = m ? (m.remainingKeys.at(-1) ?? m.toKey) : null;
  // Time still needed: the rest of the current leg, then the legs that follow.
  const legLeft = m ? Math.max(0, Date.parse(m.arrivesAt) - Math.max(now, 0)) / 1000 : 0;
  const rest = useMemo(() => {
    if (!m || m.remainingKeys.length === 0 || speed <= 0) return 0;
    const r = planRoute(m.toKey, finalKey!, {
      countryId: state.me.countryId,
      ownerByKey,
      atWarWith: new Set(state.atWarWith),
      railwayKeys,
      speed,
      gameSpeed: state.campaign.gameSpeed,
      coastalOnly: isNavalFormation(f.units),
      useRoads: !isNavalFormation(f.units) && canOccupyLand(f.units),
    });
    return r?.totalSeconds ?? 0;
  }, [m, finalKey, speed, ownerByKey, railwayKeys, state.atWarWith, state.me.countryId, state.campaign.gameSpeed, f.units]);
  const etaSeconds = voyage ? Math.max(0, (Date.parse(voyage.arrivesAt) - now) / 1000) : legLeft + rest;
  const arrivalMs = Date.now() + etaSeconds * 1000;

  const atk = f.units.reduce((s, u) => s + UNITS[u.unitType].attack * u.count, 0);
  const def = f.units.reduce((s, u) => s + UNITS[u.unitType].defense * u.count, 0);
  const total = f.units.reduce((s, u) => s + u.count, 0);
  const lead = [...f.units].sort((a, b) => b.count - a.count)[0];
  const pos = sea ? (voyage ? 'At sea' : 'At sea, holding') : m ? `Between ${PROVINCE_BY_KEY[f.provinceKey]?.name} and ${PROVINCE_BY_KEY[m.toKey]?.name}` : (PROVINCE_BY_KEY[f.provinceKey]?.name ?? '');
  const dest = voyage ? (voyage.destKey ? PROVINCE_BY_KEY[voyage.destKey]?.name : voyage.attackTargetId ? 'Enemy fleet' : 'A position at sea') : finalKey ? PROVINCE_BY_KEY[finalKey]?.name : onPatrol ? `Patrol over ${PROVINCE_BY_KEY[f.patrol!.provinceKey]?.name}` : '—';
  const is = (k: OrderKind, naval: boolean) => active?.kind === k && active.naval === naval;

  return (
    <div className="army-bar" onContextMenu={(e) => e.preventDefault()}>
      <div className="ob-row">
        <div className="ob-group">
          {hasLand && (
            <>
              <Btn label="Move" tone="green" on={is('move', false)} onClick={() => onOrder('move', false)} tip="Click anywhere on the map: the army goes to that exact spot">
                <Ic d={I.move} />
              </Btn>
              <Btn label="Attack" tone="red" on={is('attack', false)} onClick={() => onOrder('attack', false)} tip="Same as Move, aimed at enemy land. Declares war if needed">
                <Ic d={I.attack} />
              </Btn>
            </>
          )}
          {hasShips && (
            <>
              <Btn label="Sail" tone="green" on={is('move', true)} onClick={() => onOrder('move', true)} tip="Sail to a harbour or an open-sea dot">
                <Ic d={I.sail} />
              </Btn>
              <Btn label={hasLand ? 'Naval attack' : 'Attack'} tone="red" on={is('attack', true)} onClick={() => onOrder('attack', true)} tip="Attack an enemy fleet you can see">
                <Ic d={I.attack} />
              </Btn>
            </>
          )}
          {sea && !voyage && layers > 0 && (
            <Btn label="Lay mines" tone="purple" disabled={mines.isPending} onClick={() => mines.mutate()} tip="Costs money and steel; lasts a few days">
              <Ic d={I.mine} />
            </Btn>
          )}
        </div>
        {hasLand && (
          <div className="ob-group">
            <Btn label="Waypoint" tone="blue" disabled={!m} on={is('waypoint', false)} onClick={() => onOrder('waypoint', false)} tip="Add another stop after the one the army is heading to">
              <Ic d={I.waypoint} />
            </Btn>
            <Btn label="Delay" tone="blue" disabled={!m} onClick={() => setDelayOpen(true)} tip="Hold the army where it is, or time its arrival">
              <Ic d={I.delay} />
            </Btn>
            <Btn label="Split" tone="blue" disabled={busy || unitTotal < 2} onClick={onSplit} tip="Send some of the units away as a new army">
              <Ic d={I.split} />
            </Btn>
            <Btn label="Front line" tone="green" disabled={busy || hasShips || onPatrol} onClick={onFront} tip="Spread the army along the border with a country. When war comes it advances and attacks on its own.">
              <Ic d={I.front} />
            </Btn>
          </div>
        )}
        <div className="ob-group">
          <Btn label="Cancel Orders" tone="red" disabled={(!busy && !onFrontLine) || stop.isPending} onClick={() => stop.mutate()}>
            <Ic d={I.cancel} />
          </Btn>
        </div>
      </div>

      <div className="ob-panel">
        <div className="ob-head">
          <strong>{f.name}</strong>
          <button className="ob-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ob-body">
          <div className="ob-stats">
            <div>
              <span className="muted">Est. Strength</span>
              <strong>
                ATK {atk.toFixed(1)} · DEF {def.toFixed(1)}
              </strong>
            </div>
            <div>
              <span className="muted">Army Speed</span>
              <strong>{speed.toFixed(2)}</strong>
            </div>
            {f.generalId && (
              <div>
                <span className="muted">General</span>
                <strong>{GENERAL_BY_ID[f.generalId]?.name}</strong>
              </div>
            )}
          </div>
          <div className="ob-units">
            <span className="muted small">UNITS</span>
            <div className="ob-unit-row">
              {f.units.map((u) => (
                <span className="ob-unit" key={u.unitType} title={UNITS[u.unitType].name}>
                  <UnitIcon type={u.unitType} size={34} />
                  <b>{u.count}</b>
                </span>
              ))}
            </div>
            {lead && total > 0 && <span className="muted small">{total} units</span>}
          </div>
          <div className="ob-activity">
            <span className="muted small">ACTIVITY</span>
            <div>
              <span className="muted">Current Position</span>
              <strong>{pos}</strong>
            </div>
            <div>
              <span className="muted">Destination</span>
              <strong>{dest}</strong>
            </div>
            {onFrontLine && !busy && (
              <div>
                <span className="muted">Orders</span>
                <strong>Holding the front against {state.countries.find((c) => c.id === f.frontCountryId)?.name ?? 'a country'}</strong>
              </div>
            )}
            {busy && !onPatrol && (
              <>
                <div>
                  <span className="muted">Est. Travel Time</span>
                  <strong>{held ? `Waiting ${formatDuration(Math.max(0, (Date.parse(m!.holdUntil!) - now) / 1000))}` : formatDuration(etaSeconds)}</strong>
                </div>
                <div>
                  <span className="muted">Est. Arrival Time</span>
                  <strong>{clock(arrivalMs)}</strong>
                </div>
              </>
            )}
          </div>
        </div>
        {mines.error && <p className="error small">{(mines.error as Error).message}</p>}
        {stop.error && <p className="error small">{(stop.error as Error).message}</p>}
      </div>

      {delayOpen && m && (
        <DelayDialog
          campaignId={campaignId}
          formation={f}
          gameSpeed={state.campaign.gameSpeed}
          etaSeconds={etaSeconds}
          onClose={() => setDelayOpen(false)}
          onDone={() => {
            refresh();
            setDelayOpen(false);
          }}
        />
      )}
    </div>
  );
}
