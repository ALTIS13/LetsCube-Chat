import {isDeepStrictEqual,types} from 'node:util';
import {pg17HeaderProfileId,pg17Catalogs,pg17AddressFunctions} from './media-restore-pg17-header.fixture.mjs';

const fail=reason=>{throw Object.assign(new Error('pg17_header_refused:'+reason),{
  code:'pg17_header_refused',reason,
});};

// Inspect descriptors before copying: untrusted evidence must never run a getter.
function dataCopy(value,ancestors=new Set(),depth=0,budget={remaining:4096}){
  if(types.isProxy(value))fail('proxy');
  if(depth>16)fail('input-depth');
  if(--budget.remaining<0)fail('input-budget');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('shape');return value;}
  if(typeof value!=='object'||ancestors.has(value))fail('shape');
  const array=Array.isArray(value);
  if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype))fail('shape');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'))fail('shape');
  if(Object.values(descriptors).some(descriptor=>!('value' in descriptor)))fail('accessor');
  ancestors.add(value);
  let result;
  if(array){
    const length=descriptors.length.value;
    if(Object.keys(descriptors).length!==length+1)fail('shape');
    result=[];
    for(let index=0;index<length;index++){
      if(!descriptors[index])fail('shape');
      result.push(dataCopy(descriptors[index].value,ancestors,depth+1,budget));
    }
  }else result=Object.fromEntries(Object.entries(descriptors).map(([key,descriptor])=>[
    key,dataCopy(descriptor.value,ancestors,depth+1,budget),
  ]));
  ancestors.delete(value);
  return result;
}
function fields(value,expected){
  if(!value||Array.isArray(value)||typeof value!=='object'||
    !isDeepStrictEqual(Object.keys(value).sort(),[...expected].sort()))fail('shape');
}
export function assertPg17Header(input){
  const data=dataCopy(input);
  fields(data,['profileId','header']);
  if(data.profileId!==pg17HeaderProfileId)fail('profile');
  const header=data.header;
  fields(header,['serverVersionNum','catalogVersion','catalogs','functions']);
  if(header.serverVersionNum!==170006||header.catalogVersion!==202406281)fail('version');
  if(!isDeepStrictEqual(header.catalogs,pg17Catalogs))fail('catalog-shape');
  if(!isDeepStrictEqual(header.functions,pg17AddressFunctions))fail('function-shape');
  return Object.freeze({scope:'pg17-header/v1',evidence:'supplied-header-only',
    fullRestoreApproved:false,pg17Accepted:false,runtimeApproved:false,productionApproved:false});
}
