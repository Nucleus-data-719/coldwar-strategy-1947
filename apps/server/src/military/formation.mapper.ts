import type { FormationDto } from '@cw/shared';
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
        }
      : null,
  };
}
