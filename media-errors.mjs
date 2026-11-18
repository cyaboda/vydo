// Never persist raw stderr, URLs, video IDs, headers, cookies or subprocess args.
export function toolFailure(stderr,{tool='process',stage='unknown',version=null,exitCode=null}={}){
 const text=String(stderr),http=text.match(/\bHTTP(?:\s+Error|\/[\d.]+)?[: ]+(401|403|404|429|5\d\d)\b/i);
 const upstreamStatus=http?Number(http[1]):null;
 let code='TOOL_FAILURE',message='No se pudo procesar el video con las herramientas locales.',internal=true;
 if(tool==='yt-dlp'){
  internal=false;
  if(upstreamStatus===429||/too many requests|rate.limit/i.test(text)){code='YOUTUBE_RATE_LIMIT';message='YouTube ha limitado las solicitudes desde este servidor. Inténtalo más tarde.';}
  else if(/not a bot|bot verification|bot challenge/i.test(text)){code='YOUTUBE_BOT_CHECK';message='YouTube exige una verificación de usuario para esta conexión del servidor. No podemos completarla desde VYDO.';}
  else if(/age.restrict|confirm your age|inappropriate for some users/i.test(text)){code='YOUTUBE_AGE_RESTRICTED';message='Este video requiere verificar la edad en YouTube y no se puede descargar desde VYDO.';}
  else if(/private video|video is private/i.test(text)){code='YOUTUBE_PRIVATE';message='El video es privado. VYDO no accede a contenido privado.';}
  else if(/members.only|members of this channel|join this channel/i.test(text)){code='YOUTUBE_MEMBERS_ONLY';message='Este video está reservado a miembros del canal y no está disponible en VYDO.';}
  else if(/DRM|digital rights management/i.test(text)){code='YOUTUBE_DRM';message='El contenido está protegido con DRM y no se puede procesar en VYDO.';}
  else if(/not available in your country|geo.restrict|blocked.*country/i.test(text)){code='YOUTUBE_GEO_RESTRICTED';message='YouTube no ofrece este video en la región del servidor.';}
  else if(/sign in|login required|authentication required|cookies.*required/i.test(text)||upstreamStatus===401){code='YOUTUBE_LOGIN_REQUIRED';message='YouTube exige iniciar sesión para acceder a este video. VYDO no utiliza cuentas ni cookies de YouTube.';}
  else if(upstreamStatus===403){code='YOUTUBE_HTTP_403';message='YouTube rechazó el acceso desde el servidor (HTTP 403). No se intentará eludir el bloqueo.';}
  else if(/requested format.*not available/i.test(text)){code='YOUTUBE_FORMAT_UNAVAILABLE';message='YouTube ya no ofrece el formato solicitado. Analiza el enlace de nuevo.';}
  else if(/video unavailable|has been removed|copyright|no longer available/i.test(text)||upstreamStatus===404){code='YOUTUBE_UNAVAILABLE';message='YouTube indica que el video no está disponible o fue retirado.';}
  else if(/javascript runtime|signature solving|unable to extract|extractor.*error/i.test(text)){code='YTDLP_EXTRACTOR';message='El analizador de YouTube no pudo interpretar la respuesta. Es un fallo técnico del servidor.';internal=true;}
  else if(/timed? ?out|network|name resolution|connection reset|unable to download/i.test(text)||upstreamStatus>=500){code='YOUTUBE_NETWORK';message='Falló la comunicación del servidor con YouTube. Inténtalo más tarde.';}
  else {code='YTDLP_FAILURE';message='El analizador no pudo completar la solicitud. Se registró un diagnóstico técnico sin datos privados.';internal=true;}
 }else if(tool==='ffmpeg'){code='FFMPEG_FAILURE';message='No se pudo convertir el archivo en el servidor. Inténtalo de nuevo.';}
 return Object.assign(Error(message),{internal,diagnostic:{event:'media_tool_failure',tool,stage,version,code,upstreamStatus,exitCode}});
}
