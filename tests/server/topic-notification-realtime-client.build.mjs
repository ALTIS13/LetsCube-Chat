import {createRequire,builtinModules} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {realtimeClientSdkVersions} from './topic-notification-realtime-client.helper.mjs';

// Returns public code in RAM only. No repo web build, install, Docker, key or env.
export async function buildRealtimeClientBundle(){
  const require=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
  const esbuild=createRequire(require.resolve('vite'))('esbuild'),versions=await realtimeClientSdkVersions();
  const output=await esbuild.build({stdin:{contents:
    'export {runRealtimeClientBaseline,runRealtimeClientPhases,validateRealtimeClientBinding,validateRealtimeClientCredentials} from "./topic-notification-realtime-client.helper.mjs";',
    resolveDir:fileURLToPath(new URL('./',import.meta.url)),sourcefile:'topic-notification-realtime-client.entry.mjs',loader:'js'},
    bundle:true,write:false,platform:'node',target:'node22',format:'cjs',minifySyntax:true,treeShaking:true,logLevel:'silent',metafile:true,
    legalComments:'none',define:{'import.meta.url':'"file:///rt-client/client.mjs"',
      'process.env.WS_NO_BUFFER_UTIL':'"1"','process.env.WS_NO_UTF_8_VALIDATE':'"1"'},
    plugins:[{name:'unavailable-optional-ts-diagnostic',setup(build){
      // Not installed here; TS already catches its missing optional diagnostic.
      // Preserve that failure, not a fake install(), in the standalone bundle.
      build.onResolve({filter:/^source-map-support$/},()=>({path:'source-map-support',namespace:'unavailable-ts-diagnostic'}));
      build.onLoad({filter:/.*/,namespace:'unavailable-ts-diagnostic'},()=>({contents:'throw new Error("RT_CLIENT_OPTIONAL_DIAGNOSTIC_UNAVAILABLE");',loader:'js'}));
    }}]});
  const externalPackages=[...new Set(Object.values(output.metafile.outputs).flatMap(v=>v.imports).filter(v=>v.external
    &&!v.path.startsWith('node:')&&!builtinModules.includes(v.path)).map(v=>v.path))];
  if(externalPackages.length||output.outputFiles.length!==1)throw Error('RT_CLIENT_BUNDLE_NOT_SELF_CONTAINED');
  const code=output.outputFiles[0].text,sha256=createHash('sha256').update(code).digest('hex');
  const sourcePins={};for(const name of ['helper','hook','build']){
    const bytes=await readFile(new URL('./topic-notification-realtime-client.'+name+'.mjs',import.meta.url));
    sourcePins[name]=createHash('sha256').update(bytes).digest('hex');
  }
  return {code,sha256,sourcePins,versions,target:'node22',externalPackages,unavailableOptional:['source-map-support'],credentialsEmbedded:false};
}
