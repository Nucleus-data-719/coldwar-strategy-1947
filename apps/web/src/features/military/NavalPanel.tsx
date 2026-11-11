import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PROVINCE_BY_KEY,
  UNITS,
  firingPosition,
  fleetRange,
  formatDuration,
  formationSpeed,
  hasPort,
  nodeAtProgress,
  pathLength,
  portNodes,
  seaPathNodes,
  seaRange,
  startNodeFromPort,
  voyageSeconds,
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
  /** A province picked on the map (your own harbour). */
  dest: string | null;
  /** An open-sea dot picked with a right-click. */
  seaDest: number | null;
  /** An enemy fleet picked on the map. */
  enemyId: string | null;
  onPreviewSea: (nodes: number[] | null) => void;
  onClose: () => void;
}

/** Orders for ships: sail to a harbour or an open-sea dot, or attack an enemy fleet you can see. */
export function NavalPanel({ campaignId, state, formation, dest, seaDest, enemyId, onPreviewSea, onClose }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const ships = formation.units.filter((u) => UNITS[u.unitType].category === 'naval');
  const atSea = !!formation.sea;
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(ships.map((u) => [u.unitType, u.count])));
  const sendUnits = ships.map((u) => ({ unitType: u.unitType, count: atSea ? u.count : Math.min(u.count, Math.max(0, counts[u.unitType] ?? 0)) }));
  const sendTotal = sendUnits.reduce((s, u) => s + u.count, 0);
  const partial = !atSea && (sendUnits.some((u, i) => u.count !== ships[i].count) || formation.units.length !== ships.length);
  const speed = formationSpeed(sendUnits);
  const range = fleetRange(sendUnits.filter((u) => u.count > 0));
  const longest = Math.max(0, ...sendUnits.filter((u) => u.count > 0).map((u) => seaRange(u.unitType)));

  const enemy = enemyId ? (state.enemies ?? []).find((e) => e.id === enemyId) ?? null : null;

  const here = useMemo(() => {
    const s = formation.sea;
    if (!s) return null;
    const v = s.voyage;
    if (!v) return s.node;
    const st = Date.parse(v.startedAt);
    const en = Date.parse(v.arrivesAt);
    const t = en > st ? Math.min(1, Math.max(0, (now - st) / (en - st))) : 1;
    return nodeAtProgress(v.nodes, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation.sea, Math.floor(now / 5000)]);

  const plan = useMemo(() => {
    let goal: number | null = null;
    let kind: 'attack' | 'dock' | 'sail' | null = null;
    let problem: string | null = null;
    const owner = dest ? state.provinces.find((p) => p.key === dest)?.ownerCountryId : undefined;
    if (enemy) {
      goal = enemy.node;
      kind = 'attack';
    } else if (seaDest !== null) {
      goal = seaDest;
      kind = 'sail';
    } else if (dest) {
      kind = 'dock';
      if (!hasPort(dest)) problem = `${PROVINCE_BY_KEY[dest]?.name} has no coast. Pick a harbour, an open-sea dot (right-click the ocean) or an enemy fleet.`;
      else if (owner !== state.me.countryId) problem = 'Fleets can only dock in your own harbours. Right-click an enemy fleet to attack it.';
      else if (!formation.sea && dest === formation.provinceKey) problem = 'The fleet is already in that harbour.';
      else {
        const from = here ?? undefined;
        const ports = portNodes(dest);
        goal = ports.length ? (from === undefined ? ports[0] : [...ports].sort((a, b) => (seaPathNodes(from, a)?.length ?? 1e9) - (seaPathNodes(from, b)?.length ?? 1e9))[0]) : null;
      }
    }
    if (!kind || goal === null) return { kind, path: null as number[] | null, seconds: 0, problem };
    const start = here ?? startNodeFromPort(formation.provinceKey, goal);
    if (start === null) return { kind, path: null, seconds: 0, problem: 'This fleet is in a province without a harbour. Build a harbour first.' };
    let path = seaPathNodes(start, goal);
    if (!path) return { kind, path: null, seconds: 0, problem: 'No sea route there.' };
    if (kind === 'attack') path = firingPosition(path, goal, range);
    if (path.length === 1 && kind === 'sail') return { kind, path: null, seconds: 0, problem: 'The fleet is already there.' };
    const seconds = speed > 0 ? voyageSeconds(pathLength(path), speed, state.campaign.gameSpeed) : 0;
    return { kind, path, seconds, problem };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, seaDest, enemy?.id, enemy?.node, here, speed, range, formation.provinceKey, state.provinces]);

  const previewKey = plan.path ? plan.path.join('>') : '';
  useEffect(() => {
    onPreviewSea(plan.path && plan.path.length > 1 ? plan.path : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  useEffect(() => () => onPreviewSea(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = partial
    ? (Object.fromEntries(sendUnits.filter((u) => u.count > 0).map((u) => [u.unitType, u.count])) as Partial<Record<UnitType, number>>)
    : undefined;
  const go = useMutation({
    mutationFn: () => {
      if (plan.kind === 'attack') return api.navalAttack(campaignId, formation.id, enemy!.id, send);
      if (plan.kind === 'dock') return api.sailFormation(campaignId, formation.id, { provinceId: state.provinces.find((p) => p.key === dest)!.id }, send);
      return api.sailFormation(campaignId, formation.id, { node: seaDest! }, send);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  const title = plan.kind === 'attack' ? 'Attack fleet' : plan.kind === 'dock' ? 'Sail to harbour' : 'Sail to sea position';
  const ready = !!plan.path && sendTotal > 0 && !plan.problem;

  return (
    <div className="card move-panel">
      <div className="row between">
        <h2>{plan.kind ? title : 'Naval orders'}</h2>
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p>
        <strong>{formation.name}</strong>{' '}
        <span className="muted small">{atSea ? (formation.sea!.voyage ? 'sailing' : 'at sea') : `in ${PROVINCE_BY_KEY[formation.provinceKey]?.name}`}</span>
      </p>

      {atSea ? (
        <p className="muted small">The whole fleet follows the order. Fleets at sea cannot be split.</p>
      ) : (
        <>
          <h3>Ships to send</h3>
          <ul className="list compact">
            {ships.map((u) => (
              <li key={u.unitType}>
                <span>
                  {UNITS[u.unitType].name} <span className="muted small">(of {u.count}, range {seaRange(u.unitType)})</span>
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
        </>
      )}

      <p className="muted small">
        Engagement range: <strong>{range}</strong> {range === 1 ? 'step' : 'steps'} along the dots
        {longest > range ? ` (your longest guns reach ${longest}, but the fleet closes in until every ship can fire)` : ''}. Submarines must be right on top of the enemy.
      </p>

      {!plan.kind && (
        <p className="muted small">
          Click one of your harbours to sail there, right-click open ocean to sail to that spot, or right-click a red enemy fleet to attack it.
          Enemy fleets appear only when your ships, coasts or (for submarines) destroyers and corvettes can see them.
        </p>
      )}
      {plan.problem && <p className="error small">{plan.problem}</p>}
      {enemy && (
        <p className="warn small">
          ⚔ {enemy.ships > 0 ? `${enemy.ships} ship${enemy.ships === 1 ? '' : 's'}` : 'Unknown fleet'}
          {enemy.submarines ? ' including submarines. Battleships and cruisers are poor at hitting them; use destroyers and corvettes.' : '.'} If it moves out of range before you arrive, contact is lost.
        </p>
      )}
      {plan.path && (
        <p>
          {plan.kind === 'attack' ? 'Reaches firing position in ' : 'Arrives in '}
          <strong>{formatDuration(plan.seconds)}</strong>
          {state.campaign.gameSpeed !== 1 && <span className="muted small"> (game speed x{state.campaign.gameSpeed})</span>}
        </p>
      )}
      {plan.path && plan.kind !== 'attack' && state.mines?.some((m) => !m.mine && plan.path!.includes(m.node)) && (
        <p className="warn small">⚠ Known enemy mines lie on this route. Destroyers and corvettes halve the damage.</p>
      )}

      {error && <p className="error small">{error}</p>}
      <button
        className="primary"
        disabled={!ready || go.isPending}
        onClick={() => {
          setError(null);
          go.mutate();
        }}
      >
        {plan.kind === 'attack' ? 'Confirm attack' : 'Confirm'}
      </button>
    </div>
  );
}
