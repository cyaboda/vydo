import {readFile,readdir} from 'node:fs/promises';
const userA='11111111-1111-4111-8111-111111111111',userB='22222222-2222-4222-8222-222222222222';
const bootstrap=`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
 INSERT INTO auth.users VALUES('${userA}'),('${userB}');`;
export async function schema(db){await db.exec(bootstrap);const files=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql'));for(const file of files)await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));}
