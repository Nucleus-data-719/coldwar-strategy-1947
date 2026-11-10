import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  SUPPLY_PENALTY_PERCENT,
  applyRates,
  type ResourceKey,
  type Resources,
} from '@cw/shared';
import { useNow } from '../../hooks/useNow';

interface Props {
  balance: Resources;
  rates: Resources;
  /** Resources that ran out while still being used up. */
  shortages?: ResourceKey[];
  /** When `balance` was received from the server (ms). */
  receivedAt: number;
  gameSpeed: number;
}

/** Projects the balance forward locally for display only. The server stays authoritative. */
export function useProjectedBalance({ balance, rates, receivedAt, gameSpeed }: Props): Resources {
  const now = useNow(1000);
  return applyRates(balance, rates, ((now - receivedAt) / 1000) * gameSpeed);
}

const fmt = (n: number) => Math.floor(n).toLocaleString();
const fmtRate = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}/h`;

export function ResourceBar(props: Props) {
  const projected = useProjectedBalance(props);
  return (
    <div className="resources">
      {RESOURCE_KEYS.map((k) => (
        <div
          key={k}
          className={props.shortages?.includes(k) ? 'resource short' : 'resource'}
          title={
            props.shortages?.includes(k)
              ? `Out of ${RESOURCE_LABELS[k].toLowerCase()}!${SUPPLY_PENALTY_PERCENT[k] ? ` Your armies fight at -${SUPPLY_PENALTY_PERCENT[k]}% attack and defence until it recovers.` : ''}`
              : RESOURCE_LABELS[k]
          }
        >
          <span className="resource-name">{RESOURCE_LABELS[k]}</span>
          <strong>{fmt(projected[k])}</strong>
          <span className={props.rates[k] < 0 ? 'neg small' : 'pos small'}>{fmtRate(props.rates[k])}</span>
        </div>
      ))}
    </div>
  );
}
