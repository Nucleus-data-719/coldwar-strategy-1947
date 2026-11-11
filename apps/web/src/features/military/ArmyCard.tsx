import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GENERAL_BY_ID, PROVINCE_BY_KEY, UNITS, formatDuration, isAirFormation, isNavalFormation, minelayerCount, type FormationDto } from '@cw/shared';
import { api } from '../../services/api';
import { UnitIcon } from '../../components/art';
import { useNow } from '../../hooks/useNow';

interface Props {
  campaignId: string;
  formation: FormationDto;
  /** Enters destination-picking mode. */
  onOrder: () => void;
  /** Mixed forces in port: give the land units an order instead of the ships. */
  onOrderLand?: () => void;
  onDeselect: () => void;
}

/** The card for an army selected on the map: what it is, where it is, and what it can be ordered to do. */
export function ArmyCard({ campaignId, formation: f, onOrder, onOrderLand }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const m = f.movement;
  const stop = useMutation({
    mutationFn: () => api.stopFormation(campaignId, f.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['state', campaignId] }),
  });
  const finalKey = m ? (m.remainingKeys.at(-1) ?? m.toKey) : null;
  const nextIn = m ? Math.max(0, (Date.parse(m.arrivesAt) - now) / 1000) : 0;
  const total = f.units.reduce((s, u) => s + u.count, 0);
  const air = isAirFormation(f.units);
  const onPatrol = !!f.patrol;
  const sea = f.sea ?? null;
  const voyage = sea?.voyage ?? null;
  const ships = f.units.some((u) => UNITS[u.unitType].category === 'naval');
  const layers = minelayerCount(f.units);
  const mines = useMutation({
    mutationFn: () => api.layMines(campaignId, f.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['state', campaignId] }),
  });
  const voyageIn = voyage ? Math.max(0, (Date.parse(voyage.arrivesAt) - now) / 1000) : 0;

  return (
    <div className="card army-card">
      <h2>{f.name}</h2>
      <p className="small muted">
        {sea
          ? voyage
            ? `${voyage.attackTargetId ? 'Closing in on an enemy fleet' : voyage.destKey ? `Sailing to ${PROVINCE_BY_KEY[voyage.destKey]?.name}` : 'Sailing to a position at sea'}. Arrives in ${formatDuration(voyageIn)}.`
            : 'Holding position at sea.'
          : onPatrol
          ? `On patrol over ${PROVINCE_BY_KEY[f.patrol!.provinceKey]?.name}. Enemy armies and buildings inside the circle take damage over time.`
          : m?.patrol
            ? `Flying to patrol over ${PROVINCE_BY_KEY[m.toKey]?.name}. Arrives in ${formatDuration(nextIn)}.`
            : m
              ? `${air ? 'Flying' : 'Marching'} to ${PROVINCE_BY_KEY[finalKey!]?.name}. Next stop in ${formatDuration(nextIn)}.`
              : `Standing in ${PROVINCE_BY_KEY[f.provinceKey]?.name}.`}
      </p>
      <ul className="list compact">
        {f.units.map((u) => (
          <li key={u.unitType}>
            <span className="with-icon">
              <UnitIcon type={u.unitType} size={20} /> {UNITS[u.unitType].name}
            </span>
            <strong>{u.count}</strong>
          </li>
        ))}
      </ul>
      {f.generalId && <p className="small">General: {GENERAL_BY_ID[f.generalId]?.name}</p>}
      <div className="row army-orders">
        <button className="primary" onClick={onOrder} disabled={total === 0}>
          {m || onPatrol || voyage ? 'New orders…' : ships ? 'Sail / Attack…' : air ? 'Move / Attack / Patrol…' : 'Move / Attack…'}
        </button>
        {ships && !sea && f.units.some((u) => UNITS[u.unitType].category !== 'naval') && onOrderLand && (
          <button onClick={onOrderLand} disabled={total === 0}>
            Move land / air units…
          </button>
        )}
        {sea && !voyage && layers > 0 && (
          <button disabled={mines.isPending} onClick={() => mines.mutate()} data-tip="Submarines, destroyers and corvettes can lay mines. Costs money and steel; lasts a few days.">
            Lay mines
          </button>
        )}
        {(m || onPatrol || voyage) && (
          <button className="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {onPatrol ? 'Cancel patrol' : 'Cancel orders'}
          </button>
        )}
      </div>
      <p className="muted small">
        Tip: with this army selected, right-click a province on the map to order it there.{' '}
        {isNavalFormation(f.units) ? 'Ships sail along the dots on the ocean. Right-click the sea to sail there, or a red enemy fleet to attack it.' : air ? 'Aircraft fly straight; choose Patrol to circle over an area.' : 'Land forces follow the roads.'}
      </p>
      {mines.error && <p className="error small">{(mines.error as Error).message}</p>}
    </div>
  );
}
