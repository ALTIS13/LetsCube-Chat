// REL_17_6 prerequisite shape, not a restore profile or installed-runtime claim.
export const pg17HeaderProfileId='pg17.6-prerequisite';
const manifests={
  pg_type:[1247,'oid:oid typname:name typnamespace:oid typowner:oid typlen:int2 typbyval:bool typtype:char typcategory:char typispreferred:bool typisdefined:bool typdelim:char typrelid:oid typsubscript:regproc typelem:oid typarray:oid typinput:regproc typoutput:regproc typreceive:regproc typsend:regproc typmodin:regproc typmodout:regproc typanalyze:regproc typalign:char typstorage:char typnotnull:bool typbasetype:oid typtypmod:int4 typndims:int4 typcollation:oid typdefaultbin:pg_node_tree typdefault:text typacl:_aclitem'],
  pg_enum:[3501,'oid:oid enumtypid:oid enumsortorder:float4 enumlabel:name'],
  pg_range:[3541,'rngtypid:oid rngsubtype:oid rngmultitypid:oid rngcollation:oid rngsubopc:oid rngcanonical:regproc rngsubdiff:regproc'],
  pg_constraint:[2606,'oid:oid conname:name connamespace:oid contype:char condeferrable:bool condeferred:bool convalidated:bool conrelid:oid contypid:oid conindid:oid conparentid:oid confrelid:oid confupdtype:char confdeltype:char confmatchtype:char conislocal:bool coninhcount:int2 connoinherit:bool conkey:_int2 confkey:_int2 conpfeqop:_oid conppeqop:_oid conffeqop:_oid confdelsetcols:_int2 conexclop:_oid conbin:pg_node_tree'],
};
export const pg17Catalogs=Object.freeze(Object.fromEntries(Object.entries(manifests).map(([name,[oid,fields]])=>[
  name,Object.freeze({oid,attributes:Object.freeze(fields.split(' ').map(field=>{
    const [name,type]=field.split(':');return Object.freeze({name,type:'pg_catalog.'+type});
  }))}),
])));
const freezeFunction=value=>Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[
  key,Array.isArray(item)?Object.freeze(item):item,
])));
export const pg17AddressFunctions=Object.freeze([
  freezeFunction({oid:3954,name:'pg_get_object_address',kind:'f',volatility:'s',returnsSet:false,variadicTypeOid:0,
    inputs:['pg_catalog.text','pg_catalog._text','pg_catalog._text'],output:'pg_catalog.record',
    allTypes:['pg_catalog.text','pg_catalog._text','pg_catalog._text','pg_catalog.oid','pg_catalog.oid','pg_catalog.int4'],
    modes:['i','i','i','o','o','o'],names:['type','object_names','object_args','classid','objid','objsubid']}),
  freezeFunction({oid:3382,name:'pg_identify_object_as_address',kind:'f',volatility:'s',returnsSet:false,variadicTypeOid:0,
    inputs:['pg_catalog.oid','pg_catalog.oid','pg_catalog.int4'],output:'pg_catalog.record',
    allTypes:['pg_catalog.oid','pg_catalog.oid','pg_catalog.int4','pg_catalog.text','pg_catalog._text','pg_catalog._text'],
    modes:['i','i','i','o','o','o'],names:['classid','objid','objsubid','type','object_names','object_args']}),
]);
