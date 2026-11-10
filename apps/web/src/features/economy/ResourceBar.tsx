import {
  RESOURCE_KEYS,
  type RateBreakdown,
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
  /** Where each rate comes from, shown in the tooltips. */
  breakdown?: RateBreakdown;
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

const sign = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

/** The arithmetic behind one rate, as lines of text. */
function mathLines(k: ResourceKey, b?: RateBreakdown): string[] {
  if (!b) return [];
  const lines: string[] = [];
  lines.push(`${sign(b.provinces[k])} from ${b.provinceCount} province${b.provinceCount === 1 ? '' : 's'}`);
  if (Math.abs(b.buildings[k]) > 0.005) lines.push(`${sign(b.buildings[k])} from buildings`);
  if (Math.abs(b.research[k]) > 0.005) lines.push(`${sign(b.research[k])} from research (+${b.researchPercent}%)`);
  if (b.upkeep[k] > 0.005) lines.push(`−${b.upkeep[k].toFixed(1)} army upkeep`);
  lines.push(`= ${sign(b.net[k])} per hour`);
  if (b.disruptedCount > 0 && (k === 'money' || k === 'food' || k === 'manpower'))
    lines.push(`(${b.disruptedCount} captured province${b.disruptedCount === 1 ? ' is' : 's are'} not producing yet)`);
  return lines;
}

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
          `Stockpile ${fmt(projected[k])}`,
          ...mathLines(k, props.breakdown),
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
