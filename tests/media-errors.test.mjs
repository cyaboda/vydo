import test from 'node:test';
import assert from 'node:assert/strict';
import {toolFailure} from '../media-errors.mjs';
import {run} from '../engine.mjs';
test('YouTube failures distinguish HTTP, account/content restrictions and internal errors',()=>{
 for(const [text,code] of [
  ['HTTP Error 403: Forbidden','YOUTUBE_HTTP_403'],['HTTP Error 429: Too Many Requests','YOUTUBE_RATE_LIMIT'],
  ["Sign in to confirm you're not a bot",'YOUTUBE_BOT_CHECK'],['Sign in to confirm your age','YOUTUBE_AGE_RESTRICTED'],
  ['Private video','YOUTUBE_PRIVATE'],['Only available to members of this channel','YOUTUBE_MEMBERS_ONLY'],
  ['This video is DRM protected','YOUTUBE_DRM'],['Sign in to watch','YOUTUBE_LOGIN_REQUIRED'],
  ['not available in your country','YOUTUBE_GEO_RESTRICTED'],['Video unavailable','YOUTUBE_UNAVAILABLE'],
  ['Requested format is not available','YOUTUBE_FORMAT_UNAVAILABLE'],['Unable to extract signature','YTDLP_EXTRACTOR'],
  ['Connection reset','YOUTUBE_NETWORK'],['robot video 4031234567','YTDLP_FAILURE']]){
   const error=toolFailure(text,{tool:'yt-dlp',stage:'inspect',version:'2026.10.26',exitCode:1});
   assert.equal(error.diagnostic.code,code);assert.equal(error.code,undefined);
 }
 assert.equal(toolFailure('HTTP Error 403',{tool:'yt-dlp'}).internal,false);
 assert.equal(toolFailure('failed',{tool:'ffmpeg'}).internal,true);
});
test('real failed subprocess emits only allowlisted diagnostics, never private stderr',async()=>{
 const entries=[],privateText="Sign in to confirm you're not a bot Cookie: PRIVATE_COOKIE https://private.example/?token=PRIVATE_TOKEN video PRIVATE_VIDEO_ID";
 await assert.rejects(run(process.execPath,['-e',`process.stderr.write(${JSON.stringify(privateText)});process.exit(1)`],{
  tool:'yt-dlp',stage:'inspect',version:'2026.10.26',onDiagnostic:entry=>entries.push(entry)}),/verificación de usuario/);
 assert.equal(entries[0].code,'YOUTUBE_BOT_CHECK');
 assert(!/PRIVATE_|https:|Cookie/.test(JSON.stringify(entries)));
});
