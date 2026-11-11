import { and, eq, isNull } from 'drizzle-orm';
import { GARRISON_NAME, type UnitType } from '@cw/shared';
import type { DbOrTx } from '../db/db.module';
import { formationUnits, formations } from '../db/schema';

/** Adds units to the standing "Garrison" army of a country in a province, creating it if needed. */
export async function addToGarrison(
  tx: DbOrTx,
  a: { campaignId: string; countryId: string; provinceId: string; unitType: UnitType; count: number },
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(formations)
    .where(
      and(
        eq(formations.provinceId, a.provinceId),
        eq(formations.countryId, a.countryId),
        eq(formations.name, GARRISON_NAME),
        isNull(formations.moveArrivesAt),
        isNull(formations.seaNode),
      ),
    );
  const formationId =
    existing?.id ??
    (
      await tx
        .insert(formations)
        .values({ campaignId: a.campaignId, countryId: a.countryId, provinceId: a.provinceId, name: GARRISON_NAME })
        .returning()
    )[0].id;
  const [row] = await tx
    .select()
    .from(formationUnits)
    .where(and(eq(formationUnits.formationId, formationId), eq(formationUnits.unitType, a.unitType)));
  if (row) await tx.update(formationUnits).set({ count: row.count + a.count }).where(eq(formationUnits.id, row.id));
  else await tx.insert(formationUnits).values({ formationId, unitType: a.unitType, count: a.count });
}
