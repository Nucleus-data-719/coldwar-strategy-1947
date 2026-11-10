import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  applyRates,
  type Resources,
} from '@cw/shared';
import { useNow } from '../../hooks/useNow';

interface Props {
  balance: Resources;
  rates: Resources;
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
        <div key={k} className="resource" title={RESOURCE_LABELS[k]}>
          <span className="resource-name">{RESOURCE_LABELS[k]}</span>
          <strong>{fmt(projected[k])}</strong>
          <span className={props.rates[k] < 0 ? 'neg small' : 'pos small'}>{fmtRate(props.rates[k])}</span>
        </div>
      ))}
    </div>
  );
}
