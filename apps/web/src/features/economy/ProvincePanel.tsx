import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUILDINGS,
  BUILDING_TYPES,
  CAPITAL_MOVE_COST,
  CAPITAL_MOVE_SECONDS,
  MAX_ORDER_QUANTITY,
  UNIT_TYPES,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  PROVINCE_BY_KEY,
  UNITS,
  canAfford,
  formatDuration,
  scaleSeconds,
  type BuildingType,
  type GameState,
  type PartialResources,
  type Resources,
  type UnitType,
} from '@cw/shared';
import { api } from '../../services/api';
import { useNow } from '../../hooks/useNow';

interface Props {
  campaignId: string;
  state: GameState;
  provinceKey: string;
  balance: Resources;
  /** Starts a move order for one of your armies in this province. */
  onStartMove: (formationId: string) => void;
}

const costText = (cost: PartialResources) =>
  RESOURCE_KEYS.filter((k) => cost[k])
    .map((k) => `${cost[k]} ${RESOURCE_LABELS[k].toLowerCase()}`)
    .join(', ');

export function ProvincePanel({ campaignId, state, provinceKey, balance, onStartMove }: Props) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const [unitType, setUnitType] = useState<UnitType>('artillery');
  const [quantity, setQuantity] = useState(1);

  const stateProvince = state.provinces.find((p) => p.key === provinceKey);
  const provinceId = stateProvince?.id;

  const detail = useQuery({
    queryKey: ['province', campaignId, provinceId],
    queryFn: () => api.province(campaignId, provinceId!),
    enabled: !!provinceId,
  });

  const build = useMutation({
    mutationFn: (type: BuildingType) => api.build(campaignId, provinceId!, type),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      qc.invalidateQueries({ queryKey: ['province', campaignId] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const war = useMutation({
    mutationFn: (countryId: string) => api.declareWar(campaignId, countryId),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['state', campaignId] });
      qc.invalidateQueries({ queryKey: ['wars', campaignId] });
    },
    onError: (e) => setError((e as Error).message),
  });

  const refresh = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['state', campaignId] });
    qc.invalidateQueries({ queryKey: ['province', campaignId] });
  };
  const produce = useMutation({
    mutationFn: () => api.produce(campaignId, provinceId!, unitType, quantity),
    onSuccess: refresh,
    onError: (e) => setError((e as Error).message),
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => api.cancelProduction(campaignId, id),
    onSuccess: refresh,
    onError: (e) => setError((e as Error).message),
  });
  const moveCapital = useMutation({
    mutationFn: () => api.moveCapital(campaignId, provinceId!),
    onSuccess: refresh,
    onError: (e) => setError((e as Error).message),
  });

  if (!stateProvince) return null;
  if (detail.isLoading) return <div className="card">Loading province…</div>;
  if (detail.error) return <div className="card error">{(detail.error as Error).message}</div>;
  const p = detail.data;
  if (!p) return null;

  const mine = p.ownerCountryId === state.me.countryId;
  const used = p.buildings.length;
  const hasFactory = p.buildings.some((b) => b.type === 'military_factory' && b.status === 'complete');
  const factoryUnits = UNIT_TYPES.filter((t) => UNITS[t].factoryProducible);
  const orderCost: PartialResources = Object.fromEntries(
    Object.entries(UNITS[unitType].cost).map(([k, v]) => [k, (v ?? 0) * quantity]),
  );

  const blockReason = (type: BuildingType): string | null => {
    const def = BUILDINGS[type];
    if (!mine) return 'Not your province';
    if (p.buildings.some((b) => b.type === type)) return 'Already built';
    if (used >= p.buildingSlots) return 'No free slots';
    if (def.requiresCoastal && !p.isCoastal) return 'Coastal only';
    if (!canAfford(balance, def.cost)) return 'Not enough resources';
    return null;
  };

  return (
    <div className="card province-panel">
      <h2>
        {p.isCapital && '★ '}
        {p.name}
      </h2>
      <p className="muted small">
        Owner: {p.ownerName} · {p.terrain}
        {p.isCoastal ? ' · coastal' : ''} · defence {p.defense}
      </p>
      {p.disruptedUntil && new Date(p.disruptedUntil).getTime() > now && (
        <p className="warn small">
          Occupied: produces nothing for {formatDuration((new Date(p.disruptedUntil).getTime() - now) / 1000)}.
        </p>
      )}
      {!mine && (
        <>
          {state.atWarWith.includes(p.ownerCountryId) ? (
            <p className="warn small">⚔ At war with {p.ownerName}. Send an army here to attack.</p>
          ) : (
            <>
              {error && <p className="error small">{error}</p>}
              <button className="danger" disabled={war.isPending} onClick={() => war.mutate(p.ownerCountryId)}>
                Declare war on {p.ownerName}
              </button>
            </>
          )}
        </>
      )}
      <p className="muted small">Population {p.population.toLocaleString()}</p>

      <h3>Production (per hour, base)</h3>
      <div className="prod">
        {RESOURCE_KEYS.filter((k) => p.production[k] > 0).map((k) => (
          <span key={k} className="chip">
            {RESOURCE_LABELS[k]} {p.production[k]}
          </span>
        ))}
      </div>

      <h3>
        Buildings ({used}/{p.buildingSlots})
      </h3>
      {p.buildings.length === 0 && <p className="muted small">No buildings.</p>}
      <ul className="list compact">
        {p.buildings.map((b) => {
          const left = (new Date(b.completesAt).getTime() - now) / 1000;
          return (
            <li key={b.type}>
              <span>{BUILDINGS[b.type].name}</span>
              <span className="muted small">
                {b.status === 'complete' ? 'Complete' : `Building… ${formatDuration(left)}`}
              </span>
            </li>
          );
        })}
      </ul>

      <h3>Military presence</h3>
      {p.formations.length === 0 && <p className="muted small">No forces here.</p>}
      <ul className="list compact">
        {p.formations.map((f) => (
          <li key={f.id}>
            <div>
              <div>{f.name}</div>
              <div className="muted small">
                {f.units.map((u) => `${u.count} ${UNITS[u.unitType].name}`).join(', ') || 'empty'}
              </div>
            </div>
            {f.countryId === state.me.countryId && f.units.length > 0 && (
              <button onClick={() => onStartMove(f.id)}>Move…</button>
            )}
          </li>
        ))}
      </ul>

      {mine && hasFactory && (
        <>
          <h3>Factory production</h3>
          {error && <p className="error small">{error}</p>}
          <div className="row">
            <select value={unitType} onChange={(e) => setUnitType(e.target.value as UnitType)}>
              {factoryUnits.map((t) => (
                <option key={t} value={t}>
                  {UNITS[t].name}
                </option>
              ))}
            </select>
            <input
              className="unit-input"
              type="number"
              min={1}
              max={MAX_ORDER_QUANTITY}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(MAX_ORDER_QUANTITY, Number(e.target.value) || 1)))}
            />
            <button className="primary" disabled={produce.isPending || !canAfford(balance, orderCost)} onClick={() => produce.mutate()}>
              Order
            </button>
          </div>
          <p className="muted small">
            {costText(orderCost)} · {formatDuration(scaleSeconds(UNITS[unitType].buildSeconds, state.campaign.gameSpeed))} each
            {UNITS[unitType].upkeep.oil ? ` · uses ${UNITS[unitType].upkeep.oil} oil/h` : ''}
          </p>
          <ul className="list compact">
            {p.productionQueue.map((o) => (
              <li key={o.id}>
                <span>
                  {UNITS[o.unitType].name}{' '}
                  <span className="muted small">
                    {o.completesAt ? `ready in ${formatDuration((new Date(o.completesAt).getTime() - now) / 1000)}` : 'waiting'}
                  </span>
                </span>
                {!o.completesAt && (
                  <button className="link" disabled={cancelOrder.isPending} onClick={() => cancelOrder.mutate(o.id)}>
                    Cancel (refund)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {mine && !p.isCapital && (
        <>
          <h3>Capital</h3>
          {state.capitalMove ? (
            <p className="muted small">
              Capital move under way to {PROVINCE_BY_KEY[state.capitalMove.provinceKey]?.name}, ready in{' '}
              {formatDuration((new Date(state.capitalMove.completesAt).getTime() - now) / 1000)}.
            </p>
          ) : (
            <>
              <button disabled={moveCapital.isPending || !canAfford(balance, CAPITAL_MOVE_COST)} onClick={() => moveCapital.mutate()}>
                Move capital here
              </button>
              <p className="muted small">
                {costText(CAPITAL_MOVE_COST)} · takes {formatDuration(scaleSeconds(CAPITAL_MOVE_SECONDS, state.campaign.gameSpeed))}. The old
                capital keeps its role until then.
              </p>
            </>
          )}
        </>
      )}

      {mine && (
        <>
          <h3>Construct</h3>
          {error && <p className="error small">{error}</p>}
          <ul className="list build-list">
            {BUILDING_TYPES.map((type) => {
              const def = BUILDINGS[type];
              const reason = blockReason(type);
              return (
                <li key={type}>
                  <div>
                    <strong>{def.name}</strong>
                    {!def.effectActive && <span className="chip soon">effect coming later</span>}
                    <div className="muted small">{def.description}</div>
                    <div className="muted small">
                      {costText(def.cost)} · {formatDuration(scaleSeconds(def.buildSeconds, state.campaign.gameSpeed))}
                    </div>
                  </div>
                  <button
                    className="primary"
                    disabled={!!reason || build.isPending}
                    title={reason ?? 'Start construction'}
                    onClick={() => build.mutate(type)}
                  >
                    {reason ?? 'Build'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
