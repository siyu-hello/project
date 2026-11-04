import { defineConfig } from '@prisma/orm-mysql/config';
import { definePrismaConfig } from 'prisma/config';
export default definePrismaConfig({ orm: defineConfig({ contract: './prisma/contract.prisma', db: { connection: process.env.DATABASE_URL }, migrations: { dir: './prisma/generated-migrations' } }) });
