#!/usr/bin/env node
/**
 * Generate src/types/database.ts from a live Postgres database using only `psql`.
 * The Supabase CLI's `gen types` needs Docker; this does not, so it works in CI and on
 * machines without Docker. Output shape matches supabase-js's `Database` generic.
 *
 *   DATABASE_URL=postgresql://... node scripts/gen-types.mjs > src/types/database.ts
 */
import { execFileSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const q = (sql) =>
  JSON.parse(execFileSync('psql', [url, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }) || '[]');

const enums = q(`
  select coalesce(json_agg(json_build_object('name', t.typname, 'values', v.vals) order by t.typname), '[]') from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join lateral (select array_agg(e.enumlabel order by e.enumsortorder) vals from pg_enum e where e.enumtypid = t.oid) v on true
  where n.nspname = 'public' and t.typtype = 'e'`);

const columns = q(`
  select coalesce(json_agg(json_build_object(
    'table', c.table_name, 'kind', t.table_type, 'name', c.column_name, 'udt', c.udt_name,
    'data_type', c.data_type, 'nullable', c.is_nullable = 'YES',
    'has_default', c.column_default is not null or c.is_identity = 'YES' or c.is_generated = 'ALWAYS',
    'generated', c.is_generated = 'ALWAYS' or c.is_identity = 'ALWAYS'
  ) order by c.table_name, c.ordinal_position), '[]')
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'`);

const functions = q(`
  select coalesce(json_agg(json_build_object(
    'name', p.proname,
    'args', (select coalesce(json_agg(json_build_object('name', a.name, 'type', f.typ, 'has_default', a.i > p.pronargs - p.pronargdefaults) order by a.i), '[]')
             from unnest(coalesce(p.proargnames, array_fill(''::text, array[p.pronargs])), p.proargtypes::oid[]) with ordinality as a(name, toid, i)
             join lateral (select format_type(a.toid, null) typ) f on true
             where a.i <= p.pronargs and a.name <> ''),
    'returns', format_type(p.prorettype, null), 'set', p.proretset
  ) order by p.proname), '[]')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.prolang = (select oid from pg_language where lanname in ('plpgsql'))
     or (n.nspname = 'public' and p.prokind = 'f' and p.prolang = (select oid from pg_language where lanname = 'sql')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))`);

const fks = q(`
  select coalesce(json_agg(json_build_object(
    'table', c.conrelid::regclass::text, 'name', c.conname,
    'columns', (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum),
    'ref_table', c.confrelid::regclass::text,
    'ref_columns', (select array_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum),
    'one_to_one', exists (
      select 1 from pg_constraint u where u.conrelid = c.conrelid and u.contype in ('p','u') and u.conkey::int[] <@ c.conkey::int[] and c.conkey::int[] <@ u.conkey::int[]
    )
  ) order by c.conname), '[]')
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public' and c.contype = 'f'`);

const enumNames = new Set(enums.map((e) => e.name));
const strip = (rel) => rel.replace(/^public\./, '').replace(/"/g, '');
function relationships(table) {
  const rows = fks.filter((f) => strip(f.table) === table);
  if (!rows.length) return '[]';
  return '[\n' + rows.map((f) =>
    `          { foreignKeyName: ${JSON.stringify(f.name)}; columns: ${JSON.stringify(f.columns)}; isOneToOne: ${f.one_to_one}; referencedRelation: ${JSON.stringify(strip(f.ref_table))}; referencedColumns: ${JSON.stringify(f.ref_columns)} }`
  ).join(',\n') + '\n        ]';
}

function tsType(udt, dataType) {
  if (udt.startsWith('_')) return `${tsType(udt.slice(1), '')}[]`;
  if (enumNames.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  if (/^(int2|int4|int8|float4|float8|numeric|oid)$/.test(udt)) return 'number';
  if (udt === 'bool') return 'boolean';
  if (/^(json|jsonb)$/.test(udt)) return 'Json';
  if (/^(citext|daterange|tsrange|tstzrange|inet|interval)$/.test(udt)) return 'string';
  if (dataType === 'USER-DEFINED' || udt === 'record') return 'unknown';
  return 'string';
}
// format_type() output (e.g. "character varying", "timestamp with time zone", "public.app_role")
function tsFromFormat(t) {
  if (t.endsWith('[]')) return `${tsFromFormat(t.slice(0, -2))}[]`;
  const bare = t.replace(/^public\./, '');
  if (enumNames.has(bare)) return `Database["public"]["Enums"]["${bare}"]`;
  if (/^(smallint|integer|bigint|numeric|real|double precision)$/.test(t)) return 'number';
  if (t === 'boolean') return 'boolean';
  if (/^jsonb?$/.test(t)) return 'Json';
  if (t === 'void') return 'undefined';
  if (t === 'record' || t === 'trigger' || t === 'event_trigger') return 'unknown';
  return 'string';
}

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table)) byTable.set(c.table, { kind: c.kind, cols: [] });
  byTable.get(c.table).cols.push(c);
}

const out = [];
out.push('// Generated by scripts/gen-types.mjs. Do not edit by hand; run `npm run db:types`.');
out.push('export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];');
out.push('');
out.push('export type Database = {');
out.push('  public: {');
out.push('    Tables: {');
for (const [name, { kind, cols }] of byTable) {
  if (kind !== 'BASE TABLE') continue;
  out.push(`      ${name}: {`);
  out.push('        Row: {');
  for (const c of cols) out.push(`          ${c.name}: ${tsType(c.udt, c.data_type)}${c.nullable ? ' | null' : ''};`);
  out.push('        };');
  out.push('        Insert: {');
  for (const c of cols) {
    if (c.generated) continue;
    out.push(`          ${c.name}${c.nullable || c.has_default ? '?' : ''}: ${tsType(c.udt, c.data_type)}${c.nullable ? ' | null' : ''};`);
  }
  out.push('        };');
  out.push('        Update: {');
  for (const c of cols) {
    if (c.generated) continue;
    out.push(`          ${c.name}?: ${tsType(c.udt, c.data_type)}${c.nullable ? ' | null' : ''};`);
  }
  out.push('        };');
  out.push(`        Relationships: ${relationships(name)};`);
  out.push('      };');
}
out.push('    };');
out.push('    Views: {');
for (const [name, { kind, cols }] of byTable) {
  if (kind !== 'VIEW') continue;
  out.push(`      ${name}: {`);
  out.push('        Row: {');
  for (const c of cols) out.push(`          ${c.name}: ${tsType(c.udt, c.data_type)} | null;`);
  out.push('        };');
  out.push('        Relationships: [];');
  out.push('      };');
}
out.push('    };');
out.push('    Functions: {');
const seen = new Set();
for (const f of functions) {
  if (seen.has(f.name) || f.returns === 'trigger' || f.returns === 'event_trigger') continue;
  seen.add(f.name);
  const args = f.args.length
    ? `{ ${f.args.map((a) => `${a.name}${a.has_default ? '?' : ''}: ${tsFromFormat(a.type)}`).join('; ')} }`
    : 'Record<PropertyKey, never>';
  const retBare = f.returns.replace(/^public\./, '');
  let ret;
  if (byTable.has(retBare)) ret = `Database["public"]["Tables"]["${retBare}"]["Row"]`;
  else if (retBare === 'price_quote') ret = 'PriceQuote';
  else ret = tsFromFormat(f.returns);
  out.push(`      ${f.name}: { Args: ${args}; Returns: ${f.set ? `${ret}[]` : ret} };`);
}
out.push('    };');
out.push('    Enums: {');
for (const e of enums) out.push(`      ${e.name}: ${e.values.map((v) => JSON.stringify(v)).join(' | ')};`);
out.push('    };');
out.push('    CompositeTypes: {');
out.push('      price_quote: PriceQuote;');
out.push('    };');
out.push('  };');
out.push('};');
out.push('');
out.push('export type PriceQuote = {');
for (const k of ['nights','nightly_rate_cents','cleaning_fee_cents','subtotal_cents','renter_total_cents','platform_fee_bps','platform_fee_cents','owner_payout_cents']) out.push(`  ${k}: number;`);
out.push('};');
out.push('');
out.push('// Convenience aliases');
out.push('export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];');
out.push('export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];');
for (const e of enums) {
  const pascal = e.name.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
  out.push(`export type ${pascal} = Enums<"${e.name}">;`);
}
out.push('export type Profile = Tables<"profiles">;');
out.push('export type UserRole = Tables<"user_roles">;');
out.push('export type Listing = Tables<"listings">;');
out.push('export type Resort = Tables<"resorts">;');
out.push('export interface AppClaims { app_roles?: AppRole[]; owner_status?: OwnerVerificationStatus }');
process.stdout.write(out.join('\n') + '\n');
