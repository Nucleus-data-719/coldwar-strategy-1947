import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, lte, or } from 'drizzle-orm';
import {
  ALLIANCE_MAX,
  ALLIANCE_MIN_OPINION,
  ASSISTANCE_MIN_VALUE,
  OPINION_EVENTS,
  addResources,
  assistanceOpinion,
  assistanceValue,
  canAfford,
  pairOf,
  relationStage,
  spend,
  type DiplomacyStateDto,
  type PartialResources,
} from '@cw/shared';
import { DB, Db, DbOrTx } from '../db/db.module';
import { alliances, countries, relations, warCalls, wars, type NotificationRow, type WarCallRow } from '../db/schema';
import { EconomyService } from '../economy/economy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WarsService } from '../wars/wars.service';
import { adjustOpinion, alliesOf, allianceBetween, getOpinion, onWarDeclared } from './diplomacy.queries';

@Injectable()
export class DiplomacyService {
  private readonly log = new Logger(DiplomacyService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly economy: EconomyService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly wars: WarsService,
  ) {}

  private publish(campaignId: string, notes: NotificationRow[]) {
    for (const n of notes) this.notifications.publish(n);
    this.realtime.campaignUpdate(campaignId, { kind: 'diplomacy' });
  }

  async state(userId: string, campaignId: string): Promise<DiplomacyStateDto> {
    const player = await this.players.require(userId, campaignId);
    const me = player.countryId;
    const rows = await this.db.select().from(countries).where(eq(countries.campaignId, campaignId));
    const names = new Map(rows.map((c) => [c.id, c.name]));
    const rel = await this.db
      .select()
      .from(relations)
      .where(or(eq(relations.countryA, me), eq(relations.countryB, me)));
    const opinionOf = new Map(rel.map((r) => [r.countryA === me ? r.countryB : r.countryA, r.opinion]));
    const pacts = await this.db
      .select()
      .from(alliances)
      .where(or(eq(alliances.countryA, me), eq(alliances.countryB, me)));
    const pactOf = new Map(pacts.map((p) => [p.countryA === me ? p.countryB : p.countryA, p]));
    const enemies = await this.wars.enemiesOf(this.db, me);
    const calls = await this.db
      .select()
      .from(warCalls)
      .where(and(eq(warCalls.allyId, me), eq(warCalls.status, 'pending')));

    return {
      countries: rows
        .filter((c) => c.id !== me)
        .map((c) => {
          const pact = pactOf.get(c.id);
          const opinion = opinionOf.get(c.id) ?? 0;
          const atWar = enemies.has(c.id);
          return {
            countryId: c.id,
            name: c.name,
            color: c.color,
            aiControlled: c.aiControlled,
            opinion,
            stage: relationStage(opinion, atWar, pact?.status === 'active'),
            alliance: !pact ? 'none' : pact.status === 'active' ? 'active' : pact.proposedBy === me ? 'proposed_by_you' : 'proposed_to_you',
            atWar,
          } as const;
        }),
      calls: calls.map((c) => ({
        id: c.id,
        defenderId: c.defenderId,
        defenderName: names.get(c.defenderId) ?? 'Unknown',
        aggressorId: c.aggressorId,
        aggressorName: names.get(c.aggressorId) ?? 'Unknown',
        joinsAt: c.joinsAt.toISOString(),
      })),
      allianceCount: pacts.filter((p) => p.status === 'active').length,
      maxAlliances: ALLIANCE_MAX,
    };
  }

  private async activeCount(tx: DbOrTx, countryId: string) {
    return (await alliesOf(tx, countryId)).length;
  }

  /** Propose an alliance. AI countries answer at once; players get a request to accept. */
  async propose(userId: string, campaignId: string, targetId: string) {
    const player = await this.players.require(userId, campaignId);
    if (targetId === player.countryId) throw new BadRequestException('You cannot ally with yourself');
    const notes = await this.economy.lockMany([player.countryId, targetId], async (tx, rows) => {
      const me = rows.get(player.countryId)!;
      const target = rows.get(targetId)!;
      if (target.campaignId !== campaignId) throw new NotFoundException('Country not found in this campaign');
      if ((await this.wars.enemiesOf(tx, me.id)).has(target.id)) throw new BadRequestException('You are at war with them');
      if (await allianceBetween(tx, me.id, target.id)) throw new BadRequestException('There is already an alliance or a proposal');
      if ((await this.activeCount(tx, me.id)) >= ALLIANCE_MAX) throw new BadRequestException(`You can have at most ${ALLIANCE_MAX} alliances`);
      const [a, b] = pairOf(me.id, target.id);

      if (target.aiControlled) {
        const opinion = await getOpinion(tx, me.id, target.id);
        if (opinion < ALLIANCE_MIN_OPINION) {
          throw new BadRequestException(
            `${target.name} does not trust you enough (opinion ${opinion}, they need ${ALLIANCE_MIN_OPINION}). Send them aid to improve relations.`,
          );
        }
        if ((await this.activeCount(tx, target.id)) >= ALLIANCE_MAX) throw new BadRequestException(`${target.name} has too many alliances`);
        // An AI will not join someone who is at war with its own allies.
        const theirEnemies = await this.wars.enemiesOf(tx, me.id);
        for (const ally of await alliesOf(tx, target.id)) {
          if (theirEnemies.has(ally)) throw new BadRequestException(`${target.name} refuses: you are at war with their ally`);
        }
        await tx.insert(alliances).values({ campaignId, countryA: a, countryB: b, proposedBy: me.id, status: 'active' });
        await adjustOpinion(tx, campaignId, me.id, target.id, 10);
        return [
          await this.notifications.add(tx, { campaignId, countryId: me.id, type: 'alliance', message: `${target.name} accepted your alliance.` }),
        ];
      }

      await tx.insert(alliances).values({ campaignId, countryA: a, countryB: b, proposedBy: me.id, status: 'pending' });
      return [
        await this.notifications.add(tx, {
          campaignId,
          countryId: target.id,
          type: 'alliance_offer',
          message: `${me.name} proposes an alliance. Open Diplomacy to answer.`,
        }),
      ];
    });
    this.publish(campaignId, notes);
    return { ok: true };
  }

  async respond(userId: string, campaignId: string, fromId: string, accept: boolean) {
    const player = await this.players.require(userId, campaignId);
    const notes = await this.economy.lockMany([player.countryId, fromId], async (tx, rows) => {
      const me = rows.get(player.countryId)!;
      const from = rows.get(fromId)!;
      const pact = await allianceBetween(tx, me.id, from.id);
      if (!pact || pact.status !== 'pending' || pact.proposedBy !== from.id) throw new NotFoundException('No proposal from that country');
      if (!accept) {
        await tx.delete(alliances).where(eq(alliances.id, pact.id));
        return [await this.notifications.add(tx, { campaignId, countryId: from.id, type: 'alliance', message: `${me.name} declined your alliance.` })];
      }
      if ((await this.wars.enemiesOf(tx, me.id)).has(from.id)) throw new BadRequestException('You are at war with them');
      if ((await this.activeCount(tx, me.id)) >= ALLIANCE_MAX || (await this.activeCount(tx, from.id)) >= ALLIANCE_MAX) {
        throw new BadRequestException(`One of you already has ${ALLIANCE_MAX} alliances`);
      }
      await tx.update(alliances).set({ status: 'active' }).where(eq(alliances.id, pact.id));
      await adjustOpinion(tx, campaignId, me.id, from.id, 10);
      return [
        await this.notifications.add(tx, { campaignId, countryId: from.id, type: 'alliance', message: `${me.name} accepted your alliance.` }),
      ];
    });
    this.publish(campaignId, notes);
    return { ok: true };
  }

  /** End an alliance, or withdraw / decline a proposal. Breaking an active alliance costs goodwill. */
  async breakAlliance(userId: string, campaignId: string, otherId: string) {
    const player = await this.players.require(userId, campaignId);
    const notes = await this.economy.lockMany([player.countryId, otherId], async (tx, rows) => {
      const me = rows.get(player.countryId)!;
      const other = rows.get(otherId)!;
      const pact = await allianceBetween(tx, me.id, other.id);
      if (!pact) throw new NotFoundException('No alliance with that country');
      await tx.delete(alliances).where(eq(alliances.id, pact.id));
      if (pact.status !== 'active') return [];
      await adjustOpinion(tx, campaignId, me.id, other.id, OPINION_EVENTS.allianceBroken);
      return [await this.notifications.add(tx, { campaignId, countryId: other.id, type: 'alliance', message: `${me.name} ended the alliance.` })];
    });
    this.publish(campaignId, notes);
    return { ok: true };
  }

  /** Join the war now, before the countdown ends. */
  async joinNow(userId: string, campaignId: string, callId: string) {
    const player = await this.players.require(userId, campaignId);
    const [call] = await this.db.select().from(warCalls).where(eq(warCalls.id, callId));
    if (!call || call.allyId !== player.countryId || call.status !== 'pending') throw new NotFoundException('Call not found');
    await this.joinWar(call);
    return { ok: true };
  }

  /** Refuse the call. The alliance with the attacked country ends and they remember it. */
  async decline(userId: string, campaignId: string, callId: string) {
    const player = await this.players.require(userId, campaignId);
    const [call] = await this.db.select().from(warCalls).where(eq(warCalls.id, callId));
    if (!call || call.allyId !== player.countryId || call.status !== 'pending') throw new NotFoundException('Call not found');
    const notes = await this.economy.lockMany([call.allyId, call.defenderId], async (tx, rows) => {
      const [fresh] = await tx.select().from(warCalls).where(eq(warCalls.id, call.id)).for('update');
      if (!fresh || fresh.status !== 'pending') throw new BadRequestException('That call is no longer open');
      const ally = rows.get(call.allyId)!;
      const defender = rows.get(call.defenderId)!;
      await tx.update(warCalls).set({ status: 'declined' }).where(eq(warCalls.id, call.id));
      const pact = await allianceBetween(tx, ally.id, defender.id);
      if (pact) await tx.delete(alliances).where(eq(alliances.id, pact.id));
      await adjustOpinion(tx, campaignId, ally.id, defender.id, OPINION_EVENTS.callDeclined);
      return [
        await this.notifications.add(tx, {
          campaignId,
          countryId: defender.id,
          type: 'alliance',
          message: `${ally.name} refused to help and the alliance is over.`,
        }),
      ];
    });
    this.publish(campaignId, notes);
    return { ok: true };
  }

  /** Scheduler hook: calls whose mobilisation countdown has ended make the ally join the war. */
  async processDue(): Promise<void> {
    const due = await this.db
      .select()
      .from(warCalls)
      .where(and(eq(warCalls.status, 'pending'), lte(warCalls.joinsAt, new Date())))
      .limit(50);
    for (const call of due) {
      try {
        await this.joinWar(call);
      } catch (err) {
        this.log.warn(`war call ${call.id}: ${(err as Error).message}`);
        // A call that can no longer be honoured must not be retried every tick.
        await this.db.update(warCalls).set({ status: 'void' }).where(and(eq(warCalls.id, call.id), eq(warCalls.status, 'pending')));
      }
    }
  }

  /** The ally declares war on the aggressor. Anything that changed since the call voids it. */
  private async joinWar(call: WarCallRow) {
    const notes = await this.economy.lockMany([call.allyId, call.defenderId, call.aggressorId], async (tx, rows) => {
      const [fresh] = await tx.select().from(warCalls).where(eq(warCalls.id, call.id)).for('update');
      if (!fresh || fresh.status !== 'pending') throw new BadRequestException('That call is no longer open');
      const ally = rows.get(call.allyId)!;
      const defender = rows.get(call.defenderId)!;
      const aggressor = rows.get(call.aggressorId)!;

      const void_ = async (why: string) => {
        await tx.update(warCalls).set({ status: 'void' }).where(eq(warCalls.id, call.id));
        return [await this.notifications.add(tx, { campaignId: call.campaignId, countryId: ally.id, type: 'war_call', message: why })];
      };
      const pact = await allianceBetween(tx, ally.id, defender.id);
      if (!pact || pact.status !== 'active') return void_(`The call to help ${defender.name} lapsed: the alliance no longer exists.`);
      if ((await this.wars.enemiesOf(tx, ally.id)).has(aggressor.id)) return void_(`You are already at war with ${aggressor.name}.`);
      if (!(await this.wars.enemiesOf(tx, defender.id)).has(aggressor.id)) return void_(`The war against ${defender.name} is over.`);
      const aggressorPact = await allianceBetween(tx, ally.id, aggressor.id);
      if (aggressorPact?.status === 'active') return void_(`You are allied with ${aggressor.name}, so you stay out of the war.`);

      await tx.insert(wars).values({ campaignId: call.campaignId, aggressorId: ally.id, defenderId: aggressor.id });
      if (aggressorPact) await tx.delete(alliances).where(eq(alliances.id, aggressorPact.id));
      await tx.update(warCalls).set({ status: 'joined' }).where(eq(warCalls.id, call.id));
      const calls = await onWarDeclared(tx, call.campaignId, ally.id, aggressor.id);
      await adjustOpinion(tx, call.campaignId, ally.id, defender.id, OPINION_EVENTS.callHonoured);

      const out: NotificationRow[] = [
        await this.notifications.add(tx, { campaignId: call.campaignId, countryId: ally.id, type: 'war_joined', message: `You joined the war against ${aggressor.name} to defend ${defender.name}.` }),
        await this.notifications.add(tx, { campaignId: call.campaignId, countryId: defender.id, type: 'war_joined', message: `${ally.name} joined the war on your side against ${aggressor.name}.` }),
        await this.notifications.add(tx, { campaignId: call.campaignId, countryId: aggressor.id, type: 'war_declared', message: `${ally.name} has declared war on you to defend ${defender.name}!` }),
      ];
      for (const c of calls) {
        out.push(
          await this.notifications.add(tx, {
            campaignId: call.campaignId,
            countryId: c.allyId,
            type: 'war_call',
            message: `${aggressor.name}, your ally, was attacked by ${ally.name}. You will join the war automatically unless you decline.`,
          }),
        );
      }
      return out;
    });
    this.publish(call.campaignId, notes);
  }

  /** Send resources to another country. Gifts improve relations; they never buy research or units. */
  async assist(userId: string, campaignId: string, targetId: string, gift: PartialResources) {
    const player = await this.players.require(userId, campaignId);
    if (targetId === player.countryId) throw new BadRequestException('You cannot send aid to yourself');
    if (assistanceValue(gift) < ASSISTANCE_MIN_VALUE) throw new BadRequestException(`Send at least ${ASSISTANCE_MIN_VALUE} worth of aid`);
    const notes = await this.economy.lockMany([player.countryId, targetId], async (tx, rows) => {
      const me = rows.get(player.countryId)!;
      const target = rows.get(targetId)!;
      if (target.campaignId !== campaignId) throw new NotFoundException('Country not found in this campaign');
      if ((await this.wars.enemiesOf(tx, me.id)).has(target.id)) throw new BadRequestException('You are at war with them');
      const mine = await this.economy.settle(tx, me);
      const theirs = await this.economy.settle(tx, target);
      if (!canAfford(mine, gift)) throw new BadRequestException('Not enough resources');
      await this.economy.writeBalance(tx, me.id, spend(mine, gift));
      await this.economy.writeBalance(tx, target.id, addResources(theirs, gift));
      const points = assistanceOpinion(gift);
      if (points > 0) await adjustOpinion(tx, campaignId, me.id, target.id, points);
      return [
        await this.notifications.add(tx, {
          campaignId,
          countryId: target.id,
          type: 'aid',
          message: `${me.name} sent you aid.`,
        }),
      ];
    });
    this.publish(campaignId, notes);
    return { ok: true, opinionGain: assistanceOpinion(gift) };
  }
}
