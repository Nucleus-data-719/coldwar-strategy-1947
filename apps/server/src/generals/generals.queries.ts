import { and, eq, inArray } from 'drizzle-orm';
import {
  GENERALS,
  GENERAL_BY_ID,
  GENERAL_DEFEAT_LOCK_SECONDS,
  STARTER_GENERALS,
  generalLevel,
  type CombatUnit,
  type DeployedGeneral,
  type GeneralDto,
} from '@cw/shared';
import { env } from '../config/env';
import type { DbOrTx } from '../db/db.module';
import { formations, generals, type GeneralRow } from '../db/schema';

/** Makes sure the country has a row for every general; the starters are unlocked. Safe to repeat. */
export async function ensureRoster(db: DbOrTx, campaignId: string, countryId: string): Promise<void> {
  const have = await db.select({ g: generals.generalId }).from(generals).where(eq(generals.countryId, countryId));
  const known = new Set(have.map((r) => r.g));
  const missing = GENERALS.filter((g) => !known.has(g.id));
  if (missing.length === 0) return;
  await db
    .insert(generals)
    .values(missing.map((g) => ({ campaignId, countryId, generalId: g.id, unlocked: STARTER_GENERALS.includes(g.id) })))
    .onConflictDoNothing();
}

export const toGeneralDto = (r: GeneralRow): GeneralDto => ({
  generalId: r.generalId,
  unlocked: r.unlocked,
  fragments: r.fragments,
  xp: r.xp,
  level: generalLevel(r.xp),
  deployedFormationId: r.deployedFormationId,
  lockedUntil: r.lockedUntil ? r.lockedUntil.toISOString() : null,
  abilityActiveUntil: r.abilityActiveUntil ? r.abilityActiveUntil.toISOString() : null,
  abilityReadyAt: r.abilityReadyAt ? r.abilityReadyAt.toISOString() : null,
});

/** Generals currently leading the given armies. */
export async function deployedIn(db: DbOrTx, formationIds: string[]): Promise<GeneralRow[]> {
  if (formationIds.length === 0) return [];
  return db.select().from(generals).where(inArray(generals.deployedFormationId, formationIds));
}

export function toDeployed(row: GeneralRow, units: CombatUnit[]): DeployedGeneral {
  return {
    generalId: row.generalId,
    xp: row.xp,
    abilityActiveUntil: row.abilityActiveUntil ? row.abilityActiveUntil.getTime() : null,
    units,
  };
}

export interface GeneralAftermath {
  /** Messages for the owner of the general. `countryId` says who gets them. */
  notes: { countryId: string; type: string; message: string }[];
}

/**
 * After a battle: every general that fought gains experience. A general whose army was destroyed
 * is locked for 24 hours (he can still be re-deployed afterwards).
 */
export async function settleGenerals(
  db: DbOrTx,
  fought: { row: GeneralRow; countryId: string; won: boolean; destroyed: boolean }[],
  xp: { win: number; loss: number },
  now: number,
): Promise<GeneralAftermath> {
  const notes: GeneralAftermath['notes'] = [];
  for (const f of fought) {
    const gained = f.won ? xp.win : xp.loss;
    const newXp = f.row.xp + gained;
    const set: Partial<GeneralRow> = { xp: newXp };
    const def = GENERAL_BY_ID[f.row.generalId];
    const name = def?.name ?? f.row.generalId;
    if (f.destroyed) {
      set.lockedUntil = new Date(now + (GENERAL_DEFEAT_LOCK_SECONDS / env.GAME_SPEED) * 1000);
      set.deployedFormationId = null;
      notes.push({
        countryId: f.countryId,
        type: 'general_defeated',
        message: `${name} was defeated and cannot lead an army for 24 hours.`,
      });
    } else if (generalLevel(newXp) > generalLevel(f.row.xp)) {
      notes.push({
        countryId: f.countryId,
        type: 'general_level',
        message: `${name} reached level ${generalLevel(newXp)}.`,
      });
    }
    await db.update(generals).set(set).where(eq(generals.id, f.row.id));
  }
  return { notes };
}

/** Frees a general whose army was merged away or no longer exists. */
export async function moveGeneral(db: DbOrTx, fromFormationId: string, toFormationId: string): Promise<void> {
  const [onTarget] = await db.select({ id: generals.id }).from(generals).where(eq(generals.deployedFormationId, toFormationId));
  if (onTarget) return; // the army we merge into keeps its own general
  await db.update(generals).set({ deployedFormationId: toFormationId }).where(eq(generals.deployedFormationId, fromFormationId));
}

export async function formationOwnedBy(db: DbOrTx, formationId: string, countryId: string) {
  const [f] = await db
    .select()
    .from(formations)
    .where(and(eq(formations.id, formationId), eq(formations.countryId, countryId)));
  return f ?? null;
}
