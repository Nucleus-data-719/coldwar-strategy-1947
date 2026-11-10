import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  SUPPLY_PENALTY_PERCENT,
  applyRates,
  type ResourceKey,
  type Resources,
} from '@cw/shared';
import { ResourceIcon } from '../../components/Icon';
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

const USE: Record<ResourceKey, string> = {
  money: 'Pays for buildings, units and research.',
  food: 'Feeds your armies. Grows in every province.',
  oil: 'Fuels tanks, aircraft and ships. Only from oil deposits.',
  steel: 'Needed for buildings and heavy units. Only from steel deposits.',
  electronics: 'Needed for research and modern units. Only from electronics deposits.',
  rare: 'Needed for advanced technology. Only from rare-material deposits.',
  manpower: 'Soldiers for new units. Grows in every province.',
};

/** The resource strip in the top bar. Every number explains itself on hover. */
export function ResourceBar(props: Props) {
  const projected = useProjectedBalance(props);
  return (
    <div className="hud-resources" role="list">
      {RESOURCE_KEYS.map((k) => {
        const short = props.shortages?.includes(k);
        const tip = [
          RESOURCE_LABELS[k],
          USE[k],
          `Stockpile ${fmt(projected[k])} · net ${fmtRate(props.rates[k])}`,
          short
            ? `OUT OF STOCK.${SUPPLY_PENALTY_PERCENT[k] ? ` Your armies fight at -${SUPPLY_PENALTY_PERCENT[k]}% attack and defence until it recovers.` : ''}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <div key={k} role="listitem" className={short ? 'res short' : 'res'} data-tip={tip} data-tip-pos="below">
            <ResourceIcon kind={k} />
            <div className="res-text">
              <strong>{fmt(projected[k])}</strong>
              <span className={props.rates[k] < 0 ? 'neg' : 'pos'}>{fmtRate(props.rates[k])}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
