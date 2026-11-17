import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadFilename,downloadDisposition,FORMATS} from '../lib.mjs';

test('download names preserve analyzed title, accents and Unicode for every format',()=>{
 for(const format of FORMATS){
  assert.equal(downloadFilename('My Favorite Song (Official Video)',format),`My Favorite Song (Official Video).${format}`);
  assert.equal(downloadFilename('Canción 日本語 🎵',format),`Canción 日本語 🎵.${format}`);
 }
 assert.equal(downloadFilename('Cafe\u0301','mp3'),'Café.mp3');
});
test('names reject filesystem hazards, device names, controls and excessive UTF-8 length',()=>{
 for(const title of ['../CON','NUL.txt','aux','LPT¹','COM9.mp4'])assert.match(downloadFilename(title,'mp4'),/^_/);
 assert.equal(downloadFilename('  A<>:"/\\|?*\r\nB.  ','wav'),'AB.wav');
 assert.equal(downloadFilename('...','flac'),'vydo.flac');
 assert.equal(downloadFilename(null,'m4a'),'vydo.m4a');
 const long=downloadFilename('🎵'.repeat(200),'mp3');assert(Buffer.byteLength(long)<=180);assert(long.endsWith('.mp3'));assert(!long.includes('\uFFFD'));
 assert.equal(downloadFilename('Song\u202etxt','mp3'),'Songtxt.mp3');
 assert.throws(()=>downloadFilename('Song','../exe'));
});
test('Content-Disposition has safe ASCII fallback and correctly encoded UTF-8 filename',()=>{
 const name=downloadFilename("Canción 日本語 (Live)'*",'mp3'),header=downloadDisposition(name);
 assert.match(header,/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
 assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]),name);
 assert(header.includes('%27'));assert(header.includes('%28'));assert(!/[\r\n]/.test(downloadDisposition('evil\r\n"\\.mp3')));
});
