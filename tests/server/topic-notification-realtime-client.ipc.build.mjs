import {createRequire,builtinModules} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildRealtimeClientBundle} from './topic-notification-realtime-client.build.mjs';
import {loadRealtimeClientSources} from './topic-notification-realtime-client.helper.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// All outputs stay in RAM. Reuse the accepted baseline bytes, not a second SDK
// harness. The exported loader returns an embedded PUBLIC source snapshot;
// unlike the local loader, it needs neither a repository nor Git at runtime.
export async function buildRealtimeClientIpcBundle(){
  const baseline=await buildRealtimeClientBundle(),sources=await loadRealtimeClientSources();
  const require=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
  const esbuild=createRequire(require.resolve('vite'))('esbuild');
  const entry=`import baseline from 'accepted-baseline';
export {runRealtimeClientIpc,runRealtimeClientPhaseIpc} from './topic-notification-realtime-client.ipc.mjs';
export const runRealtimeClientBaseline=baseline.runRealtimeClientBaseline;
export const runRealtimeClientPhases=baseline.runRealtimeClientPhases;
const snapshot=${JSON.stringify(sources)};
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}
export async function loadRealtimeClientSources(){return freeze(structuredClone(snapshot));}
`;
  const output=await esbuild.build({stdin:{contents:entry,loader:'js',resolveDir:fileURLToPath(new URL('./',import.meta.url)),
    sourcefile:'topic-notification-realtime-client.ipc.entry.mjs'},bundle:true,write:false,platform:'node',target:'node22',format:'cjs',
    minifySyntax:true,treeShaking:true,logLevel:'silent',metafile:true,legalComments:'none',
    plugins:[{name:'accepted-baseline-memory-only',setup(build){
      build.onResolve({filter:/^accepted-baseline$/},()=>({path:'accepted-baseline',namespace:'accepted-baseline'}));
      build.onLoad({filter:/.*/,namespace:'accepted-baseline'},()=>({contents:baseline.code,loader:'js'}));
    }}]});
  const externalPackages=[...new Set(Object.values(output.metafile.outputs).flatMap(v=>v.imports)
    .filter(v=>v.external&&!v.path.startsWith('node:')&&!builtinModules.includes(v.path)).map(v=>v.path))];
  if(externalPackages.length||output.outputFiles.length!==1)throw Error('RT_CLIENT_IPC_BUNDLE_NOT_SELF_CONTAINED');
  const code=output.outputFiles[0].text,sourcePins={...baseline.sourcePins};
  for(const [key,name] of Object.entries({ipc:'ipc',ipcTest:'ipc.test',ipcBuild:'ipc.build',ipcBuildTest:'ipc.build.test'}))
    sourcePins[key]=sha(await readFile(new URL('./topic-notification-realtime-client.'+name+'.mjs',import.meta.url)));
  return {code,sha256:sha(code),sourcePins,sourceDigest:sources.digest,baselineBundleSha256:baseline.sha256,
    versions:baseline.versions,target:'node22',externalPackages,unavailableOptional:baseline.unavailableOptional,
    credentialsEmbedded:false,sourceSnapshot:'embedded-public-only'};
}
