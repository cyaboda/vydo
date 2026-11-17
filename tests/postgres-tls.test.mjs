import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {checkServerIdentity} from 'node:tls';
import {Client} from 'pg';
import {postgresConfig} from '../store.mjs';

const host='aws-0-us-east-1.pooler.supabase.com';
const uri=`postgresql://postgres.test:fixture-password@${host}:5432/postgres?sslmode=verify-full`;
test('actual pg parser loads official CA while retaining verify-full and hostname checks',async()=>{
 const options=postgresConfig(uri),url=new URL(options.connectionString);
 assert.equal(url.searchParams.get('sslmode'),'verify-full');
 const client=new Client(options),ssl=client.connectionParameters.ssl;
 assert.equal(client.host,host);assert.equal(client.user,'postgres.test');
 assert.equal(ssl.rejectUnauthorized,undefined); // Node default is true, never disabled.
 assert.equal(ssl.checkServerIdentity,undefined); // Node's standard hostname verifier.
 assert.equal(ssl.ca,await readFile(url.searchParams.get('sslrootcert'),'utf8'));
 const ca=new X509Certificate(ssl.ca);
 assert.equal(ca.ca,true);assert(ca.verify(ca.publicKey));
 assert.equal(ca.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
 assert(Date.parse(ca.validTo)>Date.now());
 const certificate={subjectaltname:'DNS:*.pooler.supabase.com'};
 assert.equal(checkServerIdentity(host,certificate),undefined);
 assert.equal(checkServerIdentity('wrong.example.com',certificate).code,'ERR_TLS_CERT_ALTNAME_INVALID');
});
test('URL options cannot downgrade verify-full and credentials remain intact',()=>{
 const config=postgresConfig(uri+'&sslmode=no-verify');
 assert.deepEqual(new URL(config.connectionString).searchParams.getAll('sslmode'),['verify-full']);
 const client=new Client(config);assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized,false);
 assert.equal(client.password,'fixture-password');
 for(const mode of ['require','verify-ca','disable','no-verify'])assert.throws(()=>postgresConfig(uri.replace('verify-full',mode)),/verify-full/);
});
test('explicit CA paths and non-Supabase PostgreSQL connections are preserved',()=>{
 const custom=postgresConfig(uri+'&sslrootcert=%2Fetc%2Fsecrets%2Fcustom.crt');
 assert.equal(new URL(custom.connectionString).searchParams.get('sslrootcert'),'/etc/secrets/custom.crt');
 assert.equal(new URL(postgresConfig(uri.replace(host,'postgres.example.com')).connectionString).searchParams.has('sslrootcert'),false);
 assert.equal(new Client(postgresConfig('postgresql://test:fixture@localhost/test')).connectionParameters.ssl,false);
});
