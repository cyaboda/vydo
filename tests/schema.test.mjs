import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {schema} from './sql-fixture.mjs';
const userA='11111111-1111-4111-8111-111111111111',userB='22222222-2222-4222-8222-222222222222';

test('migration executes in PostgreSQL, RLS isolates accounts and private quota/session tables',async t=>{
 const db=new PGlite();t.after(()=>db.close());await schema(db);
 await db.exec(`INSERT INTO public.vydo_profiles(user_id,name) VALUES('${userA}','A'),('${userB}','B');
 INSERT INTO public.vydo_history VALUES('first','${userA}','Title','LY43o01dkU4','mp3','720','done',1),('second','${userB}','Other','LY43o01dkU4','mp3','720','done',1);`);
 await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${userA}',false);`);
 assert.deepEqual((await db.query('SELECT name FROM public.vydo_profiles')).rows,[{name:'A'}]);
 assert.equal((await db.query('SELECT * FROM public.vydo_history')).rows.length,1);
 await db.exec("UPDATE public.vydo_profiles SET name='Changed' WHERE name='B'");
 await db.exec("DELETE FROM public.vydo_history WHERE id='second'");
 await assert.rejects(db.exec('SELECT * FROM private.vydo_usage'),/permission denied/);
 await assert.rejects(db.exec('SELECT * FROM private.vydo_sessions'),/permission denied/);
 await assert.rejects(db.exec(`UPDATE public.vydo_profiles SET user_id='${userB}'`),/permission denied/);
 await db.exec('RESET ROLE');
 assert.equal((await db.query(`SELECT name FROM public.vydo_profiles WHERE user_id='${userB}'`)).rows[0].name,'B');
 assert.equal((await db.query('SELECT * FROM public.vydo_history')).rows.length,2);
 await db.exec('SET ROLE anon');await assert.rejects(db.exec('SELECT * FROM public.vydo_history'),/permission denied/);
 await db.exec('RESET ROLE');
 const tables=await db.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname IN ('private','public')");
 assert(tables.rows.filter(r=>r.tablename.startsWith('vydo_')).every(r=>r.rowsecurity));
});
