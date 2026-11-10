import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PROVINCE_BY_KEY,
  UNITS,
  formatDuration,
  formationSpeed,
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
  onClose: () => void;
}

export function MovePanel({ campaignId, state, formation, dest, onPreview, onClose }: Props) {
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
  const startKey = formation.movement ? formation.movement.toKey : formation.provinceKey;

  const ownerByKey = useMemo(() => new Map(state.provinces.map((p) => [p.key, p.ownerCountryId])), [state.provinces]);
  const railwayKeys = useMemo(
    () =>
      new Set(
        state.provinces
          .filter((p) => p.buildings.some((b) => b.type === 'railway' && b.status === 'complete'))
          .map((p) => p.key),
      ),
    [state.provinces],
  );

  const route = useMemo(
    () =>
      dest && speed > 0
        ? planRoute(startKey, dest, {
            countryId: state.me.countryId,
            ownerByKey,
            atWarWith: new Set(state.atWarWith),
            railwayKeys,
            speed,
            gameSpeed: state.campaign.gameSpeed,
          })
        : null,
    [dest, startKey, speed, ownerByKey, state.atWarWith, railwayKeys, state.me.countryId, state.campaign.gameSpeed],
  );

  const pathKey = route ? route.path.join('>') : '';
  useEffect(() => {
    onPreview(route ? route.path : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);
  useEffect(() => () => onPreview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

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
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      qc.invalidateQueries({ queryKey: ['province', campaignId] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  const remainingLeg = formation.movement ? Math.max(0, (Date.parse(formation.movement.arrivesAt) - now) / 1000) : 0;
  const sameSpot = !!dest && dest === startKey && !moving;

  return (
    <div className="card move-panel">
      <div className="row between">
        <h2>Move army</h2>
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

      <h3>Destination</h3>
      {!dest && (
        <p className="muted small">
          Click a province on the map. Armies cross your own land and the land of countries you are at war with.
        </p>
      )}
      {sameSpot && <p className="error small">The army is already there. Pick a different province.</p>}
      {dest && !sameSpot && !route && (
        <p className="error small">
          No route to {PROVINCE_BY_KEY[dest]?.name}. You can only enter your own provinces and those of countries you
          are at war with. Declare war in the Diplomacy tab to attack.
        </p>
      )}
      {route && attackKeys.length > 0 && (
        <p className="warn small">
          ⚔ This route attacks {attackKeys.map((k) => PROVINCE_BY_KEY[k]?.name).join(', ')}. A battle is fought on
          arrival; if you lose, the army is destroyed.
        </p>
      )}
      {route && (
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
        disabled={!route || sameSpot || sendTotal === 0 || move.isPending}
        onClick={() => {
          setError(null);
          move.mutate();
        }}
      >
        Confirm move
      </button>
    </div>
  );
}
