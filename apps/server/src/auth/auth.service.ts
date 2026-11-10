import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import type { PublicUser } from '@cw/shared';
import { DB, Db } from '../db/db.module';
import { users } from '../db/schema';

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async register(username: string, password: string): Promise<PublicUser> {
    const key = username.toLowerCase();
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.usernameKey, key));
    if (existing) throw new ConflictException('That username is already taken');
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const [row] = await this.db
        .insert(users)
        .values({ username, usernameKey: key, passwordHash })
        .returning();
      return { id: row.id, username: row.username };
    } catch {
      // Unique index hit by a concurrent request.
      throw new ConflictException('That username is already taken');
    }
  }

  async login(username: string, password: string): Promise<PublicUser> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.usernameKey, username.toLowerCase()));
    const ok = row ? await bcrypt.compare(password, row.passwordHash) : false;
    if (!row || !ok) throw new UnauthorizedException('Wrong username or password');
    return { id: row.id, username: row.username };
  }

  async getUser(id: string): Promise<PublicUser | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? { id: row.id, username: row.username } : null;
  }
}
