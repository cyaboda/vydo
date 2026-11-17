import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {Store,postgresAdapter} from '../store.mjs';
import {schema} from './sql-fixture.mjs';
test('real PostgreSQL adapter coordinates concurrent workers with an atomic global reservation',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});t.after(()=>pool.end());
 await schema({exec:sql=>pool.query(sql)});
 const a=new Store(await postgresAdapter(process.env.TEST_DATABASE_URL)),b=new Store(await postgresAdapter(process.env.TEST_DATABASE_URL));t.after(async()=>{await a.close();await b.close();});
 const input={subject:'ip:shared',ip:'network',registered:false,worker:'worker',title:'Title',videoId:'LY43o01dkU4',format:'mp3',quality:'720'};
 const attempts=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?a:b).reserve({...input,id:'job'+i})));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 const row=await pool.query("SELECT id FROM private.vydo_usage WHERE state='active'");assert.equal(row.rows.length,1);
 await a.finish(row.rows[0].id,'done');assert.equal((await b.quota('ip:shared',false)).remaining,4);
});
