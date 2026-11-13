import { and, eq, isNull } from 'drizzle-orm';
import { armyDomain, ordinal, restPoint, sameSpot } from '@cw/shared';
import type { DbOrTx } from '../db/db.module';
import { formationUnits, formations, provinces, type FormationRow } from '../db/schema';
import { moveGeneral } from '../generals/generals.queries';

const idle = (f: FormationRow) => !f.moveArrivesAt && !f.patrolActive && f.seaNode === null;

/**
 * Armies of one country standing in the same place join into one: land with land, air with air, ships with ships.
 * Armies that were deliberately placed apart inside the province stay apart. Returns the id of the army that remains.
 */
export async function mergeIdleAt(tx: DbOrTx, formationId: string): Promise<string> {
  const [f] = await tx.select().from(formations).where(eq(formations.id, formationId)).for('update');
  if (!f || !idle(f)) return formationId;
  const [prov] = await tx.select({ key: provinces.key }).from(provinces).where(eq(provinces.id, f.provinceId));
  const here = await tx
    .select()
    .from(formations)
    .where(and(eq(formations.countryId, f.countryId), eq(formations.provinceId, f.provinceId), isNull(formations.moveArrivesAt)))
    .for('update');
  const key = prov?.key ?? '';
  const myUnits = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, f.id));
  const domain = armyDomain(myUnits);
  const myPoint = restPoint(key, f.restX, f.restY);

  const group: FormationRow[] = [];
  for (const o of here) {
    if (!idle(o)) continue;
    if ((o.frontCountryId ?? null) !== (f.frontCountryId ?? null)) continue;
    if (o.id !== f.id) {
      const ou = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, o.id));
      if (ou.length === 0 || armyDomain(ou) !== domain) continue;
    }
    if (!sameSpot(myPoint, restPoint(key, o.restX, o.restY))) continue;
    group.push(o);
  }
  if (group.length < 2) return f.id;

  group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const target = group[0];
  for (const src of group.slice(1)) {
    const srcUnits = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, src.id));
    const tgtUnits = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, target.id));
    for (const u of srcUnits) {
      const same = tgtUnits.find((t) => t.unitType === u.unitType);
      if (same) {
        await tx.update(formationUnits).set({ count: same.count + u.count }).where(eq(formationUnits.id, same.id));
        await tx.delete(formationUnits).where(eq(formationUnits.id, u.id));
        same.count += u.count;
      } else {
        await tx.update(formationUnits).set({ formationId: target.id }).where(eq(formationUnits.id, u.id));
        tgtUnits.push({ ...u, formationId: target.id });
      }
    }
    await moveGeneral(tx, src.id, target.id);
    await tx.delete(formations).where(eq(formations.id, src.id));
  }
  // a mix of unit types is an Army with a number; a single kind keeps its name
  const after = await tx.select().from(formationUnits).where(eq(formationUnits.formationId, target.id));
  if (after.length > 1 && !/ Army$/.test(target.name) && domain === 'land') {
    const mine = await tx.select({ name: formations.name }).from(formations).where(eq(formations.countryId, target.countryId));
    let n = mine.filter((m) => / Army$/.test(m.name)).length + 1;
    const taken = new Set(mine.map((m) => m.name));
    while (taken.has(`${ordinal(n)} Army`)) n++;
    await tx.update(formations).set({ name: `${ordinal(n)} Army` }).where(eq(formations.id, target.id));
  }
  return target.id;
}
