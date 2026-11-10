import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { MOBILISATION_SECONDS, OPINION_EVENTS, clampOpinion, countriesToCall, pairOf } from '@cw/shared';
import { env } from '../config/env';
import type { DbOrTx } from '../db/db.module';
import { alliances, relations, warCalls, wars, type WarCallRow } from '../db/schema';

export async function getOpinion(db: DbOrTx, a: string, b: string): Promise<number> {
  const [x, y] = pairOf(a, b);
  const [row] = await db
    .select({ opinion: relations.opinion })
    .from(relations)
    .where(and(eq(relations.countryA, x), eq(relations.countryB, y)));
  return row?.opinion ?? 0;
}

/** Adds `delta` to how two countries feel about each other, staying inside -100..100. */
export async function adjustOpinion(db: DbOrTx, campaignId: string, a: string, b: string, delta: number): Promise<void> {
  const [x, y] = pairOf(a, b);
  await db
    .insert(relations)
    .values({ campaignId, countryA: x, countryB: y, opinion: clampOpinion(delta) })
    .onConflictDoUpdate({
      target: [relations.countryA, relations.countryB],
      set: { opinion: sql`LEAST(100, GREATEST(-100, ${relations.opinion} + ${delta}))` },
    });
}

/** Ids of the countries this one has an active alliance with. */
export async function alliesOf(db: DbOrTx, countryId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(alliances)
    .where(and(eq(alliances.status, 'active'), or(eq(alliances.countryA, countryId), eq(alliances.countryB, countryId))));
  return rows.map((r) => (r.countryA === countryId ? r.countryB : r.countryA));
}

export async function allianceBetween(db: DbOrTx, a: string, b: string) {
  const [x, y] = pairOf(a, b);
  const [row] = await db.select().from(alliances).where(and(eq(alliances.countryA, x), eq(alliances.countryB, y)));
  return row ?? null;
}

/**
 * Called when `aggressorId` declares war on `defenderId`: the two fall out, and every ally of the
 * defender gets a call to war with a mobilisation countdown. Returns the calls created.
 */
export async function onWarDeclared(
  tx: DbOrTx,
  campaignId: string,
  aggressorId: string,
  defenderId: string,
): Promise<WarCallRow[]> {
  await adjustOpinion(tx, campaignId, aggressorId, defenderId, OPINION_EVENTS.warDeclared);

  const allies = await alliesOf(tx, defenderId);
  if (allies.length === 0) return [];
  const aggressorAllies = await alliesOf(tx, aggressorId);
  const atWar = await tx
    .select()
    .from(wars)
    .where(
      and(
        sql`${wars.endedAt} IS NULL`,
        or(
          and(eq(wars.aggressorId, aggressorId), inArray(wars.defenderId, allies)),
          and(eq(wars.defenderId, aggressorId), inArray(wars.aggressorId, allies)),
        ),
      ),
    );
  const alreadyAtWar = atWar.map((w) => (w.aggressorId === aggressorId ? w.defenderId : w.aggressorId));
  const called = countriesToCall(allies, aggressorId, aggressorAllies, alreadyAtWar);
  if (called.length === 0) return [];

  const joinsAt = new Date(Date.now() + (MOBILISATION_SECONDS / env.GAME_SPEED) * 1000);
  return tx
    .insert(warCalls)
    .values(called.map((allyId) => ({ campaignId, allyId, defenderId, aggressorId, joinsAt })))
    .onConflictDoNothing()
    .returning();
}
