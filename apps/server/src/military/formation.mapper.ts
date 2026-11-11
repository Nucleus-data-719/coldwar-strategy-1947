import { patrolRadius, type FormationDto } from '@cw/shared';
import type { FormationRow, FormationUnitRow } from '../db/schema';

/** Converts a formation row to the DTO the browser uses. `keyById` maps province ids to map keys. */
export function toFormationDto(
  f: FormationRow,
  units: FormationUnitRow[],
  keyById: ReadonlyMap<string, string>,
): FormationDto {
  const moving = f.moveArrivesAt && f.moveStartedAt && f.moveNextProvinceId;
  return {
    id: f.id,
    name: f.name,
    countryId: f.countryId,
    provinceKey: keyById.get(f.provinceId) ?? '',
    units: units.map((u) => ({ unitType: u.unitType, count: u.count })),
    movement: moving
      ? {
          toKey: keyById.get(f.moveNextProvinceId!) ?? '',
          remainingKeys: f.movePath.map((id) => keyById.get(id) ?? '').filter(Boolean),
          startedAt: f.moveStartedAt!.toISOString(),
          arrivesAt: f.moveArrivesAt!.toISOString(),
          patrol: f.movePatrol,
          holdUntil: f.moveHoldUntil && f.moveHoldUntil.getTime() > Date.now() ? f.moveHoldUntil.toISOString() : null,
          holdFraction: f.moveHoldFraction ?? 0,
        }
      : null,
    patrol: f.patrolActive
      ? { provinceKey: keyById.get(f.provinceId) ?? '', radius: patrolRadius(units), since: (f.patrolSince ?? f.createdAt).toISOString() }
      : null,
    sea:
      f.seaNode !== null
        ? {
            node: f.seaNode,
            voyage:
              f.seaArrivesAt && f.seaStartedAt && f.seaPath.length > 0
                ? {
                    nodes: f.seaPath,
                    startedAt: f.seaStartedAt.toISOString(),
                    arrivesAt: f.seaArrivesAt.toISOString(),
                    destKey: f.seaDestProvinceId ? (keyById.get(f.seaDestProvinceId) ?? null) : null,
                    attackTargetId: f.attackTargetId,
                  }
                : null,
          }
        : null,
  };
}
