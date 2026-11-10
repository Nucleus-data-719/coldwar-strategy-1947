import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { env } from '../config/env';

export const DB = 'DB';
export type Db = NodePgDatabase<typeof schema>;
/** Either the pool-backed database or a transaction; both expose the same query API. */
export type DbOrTx = PgDatabase<NodePgQueryResultHKT, typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
