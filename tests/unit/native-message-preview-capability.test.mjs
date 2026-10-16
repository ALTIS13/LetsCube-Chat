import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {messagePreviewStubs} from '../android/message-preview-stubs.fixture.mjs';

const root=resolve(import.meta.dirname,'../..');
const java=join(root,'android/app/src/main/java/com/kub/messenger');
const names=['MessagePreviewVerificationState','MessagePreviewResponseParser','MessagePreviewVerificationRuntime','MessagePreviewHttpTransport'];
const paths=names.map(name=>join(java,name+'.java'));
const prefix='letscube-native-capability-';
const home=process.env.MESSAGE_PREVIEW_TEST_JDK??'C:/Program Files/Android/Android Studio/jbr';
const binary=name=>join(home,'bin',name+(process.platform==='win32'?'.exe':''));
let directory;
function compile(target,selected=paths){
  const stubs=Object.entries(messagePreviewStubs).filter(([name])=>name.startsWith('org/json/')||name==='android/util/Base64.java')
    .map(([name,text])=>{const file=join(target,'stubs',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);return file;});
  const result=spawnSync(binary('javac'),['-encoding','UTF-8','-g:none','-d',target,...selected,
    join(root,'tests/android/MessagePreviewCapabilityProbe.java'),...stubs],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:256*1024});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
}
function clean(target){const actual=realpathSync(target);assert.equal(actual,resolve(target));
  assert.equal(dirname(actual),realpathSync(tmpdir()));assert.ok(basename(actual).startsWith(prefix));rmSync(actual,{recursive:true});}
function run(scenario,target=directory){const result=spawnSync(binary('java'),['-cp',target,'com.kub.messenger.MessagePreviewCapabilityProbe',scenario],
  {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:64*1024});assert.equal(result.error,undefined);return result;}
function healthy(scenario,target=directory){const result=run(scenario,target);assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');assert.equal(result.stdout.trim(),'PASS '+scenario);}
test.before(()=>{directory=mkdtempSync(join(tmpdir(),prefix));compile(directory);});
test.after(()=>{if(directory)clean(directory);});
const parser=['levels','missing','versions','level-types','unknown','root-map','empty','multiple','row-null','row-list','root-null','root-scalar',
  ...['recipient_id','session_id','device_id'].flatMap(field=>['tuple-'+field,'type-'+field]),
  ...['recipient','session','device'].map(field=>'expected-'+field)];
const transport=['fixed','short-deadline','empty','multiple','root-map','row-scalar','unknown','expired',
  ...['device','device-null','device-injection','device-uppercase','access','access-bound','key','key-bound'].map(field=>'invalid-'+field),
  ...['201','301','302','307','308','401','403','429','500'].map(status=>'status-'+status),
  'wrong-type','declared-large','stream-large','deadline-write','deadline-status','deadline-read','cancel'];
for(const scenario of [...parser.map(name=>'parser-'+name),...transport.map(name=>'transport-'+name)])
  test('compiled capability: '+scenario,()=>healthy(scenario));

const mutations=[
  [3,'fixed capability endpoint','https://core.letscube.ru/rest/v1/rpc/native_message_preview_capability',
    'https://core.letscube.ru/rest/v1/rpc/native_push_device_binding','transport-fixed','CAPABILITY_FIXED_RPC'],
  [3,'device admission','boolean validDevice = MessagePreviewVerificationState.uuid(device);','boolean validDevice = true;',
    'transport-invalid-device-injection','TRANSPORT_REFUSAL_REQUIRED'],
  [3,'exact device argument',String.raw`("{\"p_device_id\":\"" + device + "\"}")`,String.raw`("{\"device_id\":\"" + device + "\"}")`,
    'transport-fixed','CAPABILITY_EXACT_BODY'],
  [1,'exact five keys','row.size() != 5','false','parser-unknown','CAPABILITY_REFUSED'],
  [1,'one parser row','((List<?>) response).size() != 1','false','parser-multiple','CAPABILITY_REFUSED'],
  [1,'version number','((Number) version).doubleValue() != 1d','false','parser-versions','CAPABILITY_REFUSED'],
  [1,'recipient tuple','!recipient.equals(row.get("recipient_id"))','false','parser-tuple-recipient_id','CAPABILITY_REFUSED'],
  [1,'session tuple','!session.equals(row.get("session_id"))','false','parser-tuple-session_id','CAPABILITY_REFUSED'],
  [1,'device tuple','!device.equals(row.get("device_id"))','false','parser-tuple-device_id','CAPABILITY_REFUSED'],
  [1,'expected UUID','!MessagePreviewVerificationState.uuid(recipient)','false','parser-expected-recipient','EXPECTED_UUID_REQUIRED'],
  [1,'expected session UUID','!MessagePreviewVerificationState.uuid(session)','false','parser-expected-session','EXPECTED_UUID_REQUIRED'],
  [1,'expected device UUID','!MessagePreviewVerificationState.uuid(device)','false','parser-expected-device','EXPECTED_UUID_REQUIRED'],
  [1,'known level','return "none".equals(level) || "sender".equals(level) || "message".equals(level) ? (String) level : null;',
    'return level instanceof String ? (String) level : null;','parser-level-types','CAPABILITY_REFUSED'],
  [3,'unknown fields preserved','return rows != null && rows.size() == 1 ? rows : null;\n    }\n    Object preview',
    'if (rows != null) for (Map<String,Object> row : rows) row.remove("unknown");\n        return rows != null && rows.size() == 1 ? rows : null;\n    }\n    Object preview',
    'transport-unknown','UNKNOWN_FIELD_NOT_PROJECTED_AWAY'],
  [3,'one transport row','return rows != null && rows.size() == 1 ? rows : null;\n    }\n    Object preview',
    'return rows;\n    }\n    Object preview','transport-multiple','TRANSPORT_EXACT_ONE_ROW'],
  [3,'no redirects','setInstanceFollowRedirects(false)','setInstanceFollowRedirects(true)','transport-fixed','CAPABILITY_NO_REDIRECT_CACHE'],
  [3,'status200','connection.getResponseCode() != 200','false','transport-status-302','TRANSPORT_REFUSAL_REQUIRED'],
  [3,'deadline boundary','left <= 0','left < 0','transport-expired','TRANSPORT_REFUSAL_REQUIRED'],
  [3,'body bound','output.size() + count > MAX_BODY','false','transport-stream-large','TRANSPORT_REFUSAL_REQUIRED'],
];
for(const [index,name,before,after,scenario,oracle] of mutations)test('compiled capability mutant: '+name,()=>{
  healthy(scenario);const source=readFileSync(paths[index],'utf8');assert.equal(source.split(before).length,2,'EXACT_ONE_RULE');
  const target=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{const changed=join(target,names[index]+'.java');writeFileSync(changed,source.replace(before,after));
    compile(target,paths.map((path,i)=>i===index?changed:path));const result=run(scenario,target);
    assert.equal(result.status,1,'compiled behavioral failure, not fixture/timeout');assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{clean(target);}
});
