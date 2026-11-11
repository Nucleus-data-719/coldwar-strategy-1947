import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PROVINCE_BY_KEY,
  UNITS,
  formatDuration,
  canOccupyLand,
  formationSpeed,
  isAirFormation,
  isNavalFormation,
  patrolDistance,
  patrolFlightSeconds,
  patrolRadius,
  PATROL_MAX_FLIGHT,
  planRoute,
  type FormationDto,
  type GameState,
  type UnitType,
} from '@cw/shared';
import { api } from '../../services/api';
import { useNow } from '../../hooks/useNow';

interface Props {
  campaignId: string;
  state: GameState;
  formation: FormationDto;
  /** Destination chosen by clicking the map. */
  dest: string | null;
  /** Lets the map draw the previewed route. */
  onPreview: (path: string[] | null) => void;
  /** Which order button was pressed: a plain move, an attack, or an extra stop after the current route. */
  kind?: 'move' | 'attack' | 'waypoint';
  /** Lets the map draw the circle of a patrol being planned. */
  onPatrolPreview: (circle: { key: string; radius: number } | null) => void;
  onClose: () => void;
}

export function MovePanel({ campaignId, state, formation, dest, kind = 'move', onPreview, onPatrolPreview, onClose }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const moving = !!formation.movement;

  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(formation.units.map((u) => [u.unitType, u.count])),
  );

  const sendUnits = formation.units.map((u) => ({
    unitType: u.unitType,
    count: moving ? u.count : Math.min(u.count, Math.max(0, counts[u.unitType] ?? 0)),
  }));
  const sendTotal = sendUnits.reduce((s, u) => s + u.count, 0);
  const speed = formationSpeed(sendUnits);
  const partial = !moving && sendUnits.some((u, i) => u.count !== formation.units[i].count);
  const waypoint = kind === 'waypoint' && moving;
  const startKey = formation.movement
    ? waypoint
      ? (formation.movement.remainingKeys.at(-1) ?? formation.movement.toKey)
      : formation.movement.toKey
    : formation.provinceKey;

  const ownerByKey = useMemo(() => new Map(state.provinces.map((p) => [p.key, p.ownerCountryId])), [state.provinces]);
  const railwayKeys = useMemo(
    () =>
      new Set(
        state.provinces
          .filter((p) => p.buildings.some((b) => b.type === 'railway' && b.status === 'complete' && b.damage < 50))
          .map((p) => p.key),
      ),
    [state.provinces],
  );

  const airOnly = !moving && isAirFormation(sendUnits.filter((u) => u.count > 0));
  const [mode, setMode] = useState<'attack' | 'patrol'>('attack');
  const patrolling = airOnly && mode === 'patrol';
  const radius = patrolRadius(sendUnits.filter((u) => u.count > 0));
  const flightDistance = dest ? patrolDistance(startKey, dest) : 0;
  const tooFar = patrolling && flightDistance > PATROL_MAX_FLIGHT;
  const flightSeconds = dest && speed > 0 ? patrolFlightSeconds(startKey, dest, speed, state.campaign.gameSpeed) : 0;

  const route = useMemo(
    () =>
      dest && speed > 0 && !patrolling
        ? planRoute(startKey, dest, {
            countryId: state.me.countryId,
            ownerByKey,
            atWarWith: new Set(state.atWarWith),
            railwayKeys,
            speed,
            gameSpeed: state.campaign.gameSpeed,
            coastalOnly: isNavalFormation(sendUnits),
            useRoads: !isNavalFormation(sendUnits) && canOccupyLand(sendUnits),
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dest, startKey, speed, ownerByKey, state.atWarWith, railwayKeys, state.me.countryId, state.campaign.gameSpeed, patrolling],
  );

  const previewKey = patrolling ? (dest && dest !== startKey ? `${startKey}>${dest}` : '') : route ? route.path.join('>') : '';
  useEffect(() => {
    if (patrolling) onPreview(dest && dest !== startKey ? [startKey, dest] : null);
    else onPreview(route ? route.path : null);
    onPatrolPreview(patrolling && dest ? { key: dest, radius } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, patrolling, dest, radius]);
  useEffect(
    () => () => {
      onPreview(null);
      onPatrolPreview(null);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const attackKeys = route ? route.path.filter((k) => ownerByKey.get(k) !== state.me.countryId) : [];
  const destProvince = dest ? state.provinces.find((p) => p.key === dest) : undefined;

  const move = useMutation({
    mutationFn: () =>
      api.moveFormation(
        campaignId,
        formation.id,
        destProvince!.id,
        partial
          ? (Object.fromEntries(sendUnits.filter((u) => u.count > 0).map((u) => [u.unitType, u.count])) as Partial<
              Record<UnitType, number>
            >)
          : undefined,
        waypoint,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      qc.invalidateQueries({ queryKey: ['province', campaignId] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  const patrol = useMutation({
    mutationFn: () =>
      api.patrolFormation(
        campaignId,
        formation.id,
        destProvince!.id,
        partial
          ? (Object.fromEntries(sendUnits.filter((u) => u.count > 0).map((u) => [u.unitType, u.count])) as Partial<
              Record<UnitType, number>
            >)
          : undefined,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  const stop = useMutation({
    mutationFn: () => api.stopFormation(campaignId, formation.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });
  const attacking = !!dest && !!route && ownerByKey.get(dest) !== state.me.countryId;
  // Move and Attack are separate orders: a move must stay on your own land, an attack must end in enemy land.
  const wrongKind = !patrolling && !!route && (kind === 'attack' ? attackKeys.length === 0 : kind === 'move' && attackKeys.length > 0);

  const remainingLeg = formation.movement ? Math.max(0, (Date.parse(formation.movement.arrivesAt) - now) / 1000) : 0;
  const sameSpot = !patrolling && !!dest && dest === startKey && !moving;

  return (
    <div className="card move-panel">
      <div className="row between">
        <h2>{patrolling ? 'Patrol' : kind === 'waypoint' ? 'Add waypoint' : kind === 'attack' ? 'Attack' : 'Move'}</h2>
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p>
        <strong>{formation.name}</strong>{' '}
        <span className="muted small">
          in {PROVINCE_BY_KEY[formation.provinceKey]?.name}
          {moving ? ' (marching)' : ''}
        </span>
      </p>

      {moving ? (
        <p className="muted small">
          This army will finish its current leg, then follow the new route.
        </p>
      ) : (
        <>
          <h3>Units to send</h3>
          <ul className="list compact">
            {formation.units.map((u) => (
              <li key={u.unitType}>
                <span>
                  {UNITS[u.unitType].name} <span className="muted small">(of {u.count})</span>
                </span>
                <input
                  className="unit-input"
                  type="number"
                  min={0}
                  max={u.count}
                  value={counts[u.unitType] ?? 0}
                  onChange={(e) => setCounts({ ...counts, [u.unitType]: Number(e.target.value) })}
                />
              </li>
            ))}
          </ul>
          {partial && <p className="muted small">The rest stay behind. The units you send form a new task force.</p>}
        </>
      )}

      {airOnly && (
        <div className="seg" role="tablist" aria-label="Air order">
          <button role="tab" className={mode === 'attack' ? 'active' : ''} onClick={() => setMode('attack')} data-tip="Fly to a province; over an enemy province this is a strike and a battle">
            Attack / Move
          </button>
          <button role="tab" className={mode === 'patrol' ? 'active' : ''} onClick={() => setMode('patrol')} data-tip="Circle over an area and wear down enemy armies and buildings there">
            Patrol
          </button>
        </div>
      )}

      {!moving && !airOnly && formation.units.some((u) => UNITS[u.unitType].category === 'air') && (
        <p className="muted small">To give the aircraft an air order (patrol), set the land units above to 0.</p>
      )}

      <h3>{patrolling ? 'Patrol area' : 'Destination'}</h3>
      {patrolling && (
        <p className="muted small">
          The aircraft fly there and circle over the area (shown on the map) until you cancel. Armies and buildings of countries you are at
          war with inside the circle take damage over time; your aircraft take some damage from air defence over enemy land and from enemy
          fighters. Over friendly land only enemies are hurt.
        </p>
      )}
      {tooFar && <p className="error small">Too far for these aircraft. Patrol closer to where they are based.</p>}
      {patrolling && dest && !tooFar && !sameSpot && (
        <p>
          Flight time <strong>{formatDuration(flightSeconds)}</strong>
          {ownerByKey.get(dest) !== state.me.countryId && <span className="warn small"> · over {state.atWarWith.includes(ownerByKey.get(dest) ?? '') ? 'enemy' : 'foreign'} land</span>}
        </p>
      )}
      {!patrolling && !dest && (
        <p className="muted small">
          Click a province on the map. Land forces follow the roads, across your own land and the land of countries you are at war with.
        </p>
      )}
      {wrongKind && (
        <p className="error small">
          {kind === 'attack' ? 'That route does not end in enemy land. Use Move for your own provinces, or pick an enemy province.' : 'That route enters enemy land. Use the Attack order instead.'}
        </p>
      )}
      {sameSpot && <p className="error small">The army is already there. Pick a different province.</p>}
      {!patrolling && dest && !sameSpot && !route && (
        <p className="error small">
          No route to {PROVINCE_BY_KEY[dest]?.name}. You can only enter your own provinces and those of countries you
          are at war with. Declare war in the Diplomacy tab to attack.
        </p>
      )}
      {!patrolling && route && attackKeys.length > 0 && (
        <p className="warn small">
          ⚔ This route attacks {attackKeys.map((k) => PROVINCE_BY_KEY[k]?.name).join(', ')}. A battle is fought on
          arrival; if you lose, the army is destroyed.
        </p>
      )}
      {!patrolling && route && (
        <>
          <p className="small">
            {route.path.map((k) => PROVINCE_BY_KEY[k]?.name).join(' → ')}
          </p>
          <p>
            Arrives in <strong>{formatDuration(route.totalSeconds + remainingLeg)}</strong>
            {state.campaign.gameSpeed !== 1 && <span className="muted small"> (game speed x{state.campaign.gameSpeed})</span>}
          </p>
        </>
      )}

      {error && <p className="error small">{error}</p>}
      <button
        className="primary"
        disabled={
          patrolling
            ? !dest || tooFar || sendTotal === 0 || patrol.isPending
            : !route || sameSpot || wrongKind || sendTotal === 0 || move.isPending
        }
        onClick={() => {
          setError(null);
          if (patrolling) patrol.mutate();
          else move.mutate();
        }}
      >
        {patrolling ? 'Confirm patrol' : kind === 'attack' ? 'Confirm attack' : kind === 'waypoint' ? 'Add waypoint' : 'Confirm move'}
      </button>
      {moving && (
        <button className="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
          Cancel orders
        </button>
      )}
    </div>
  );
}
