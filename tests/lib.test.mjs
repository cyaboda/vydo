import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYoutubeUrl,validateRequest,secureEqual} from '../lib.mjs';
test('links de Youtube normalizados',()=>{assert.equal(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');assert.equal(parseYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');});
test('bloquea hosts y esquemas distintos',()=>{for(const url of ['http://youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com.evil.org/watch?v=dQw4w9WgXcQ','https://127.0.0.1','file:///etc/passwd','https://youtube.com/playlist?list=abc'])assert.throws(()=>parseYoutubeUrl(url));});
test('valida formato, calidad y autorización',()=>{const input={url:'https://youtu.be/dQw4w9WgXcQ',format:'wav',quality:'720',authorized:true};assert.equal(validateRequest(input).format,'wav');assert.throws(()=>validateRequest({...input,format:'exe'}));assert.throws(()=>validateRequest({...input,quality:'best'}));assert.throws(()=>validateRequest({...input,authorized:false}));});
test('compara credenciales',()=>{assert.equal(secureEqual('test','test'),true);assert.equal(secureEqual('test','bad'),false);});
