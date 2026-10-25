import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {mediaViewerExportMetadata} from '../../artifacts/kub/src/lib/mediaFileAction.ts';

for (const file of ['ChatWindow','ChatInfoPanel']) {
  const source=await readFile(new URL(`../../artifacts/kub/src/components/chat/${file}.tsx`,import.meta.url),'utf8');
  const tree=ts.createSourceFile(file+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='openMediaItem') expression=node.initializer.getText(tree);ts.forEachChild(node,visit);}
  visit(tree); assert.ok(expression,'actual mounted viewer initializer');
  const render = (text,row={id:'synthetic',type:'image',content:'Synthetic'}) => {
    const code=ts.transpileModule('return '+text+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    return new Function('openMediaRow','openMediaUrl','offeredMediaUrl','mediaOriginality','isUncompressedMedia','mediaViewerExportMetadata','ensureMessageMediaUrl',code)(
      row,'blob:cached-original',null,()=> 'unknown',()=>false,mediaViewerExportMetadata,async()=>null);
  };
  test(`${file}: cold signed-only viewer accepts a cached Blob without a network address`,()=>{
    assert.equal(render(expression)?.url,'blob:cached-original');
    assert.equal(render(expression)?.loading,false);
  });
  test(`${file}: cold binary original retains object filename and MIME without a signed address`,()=>{
    for(const [type,path,mime] of [['image','qa/original.webp','image/webp'],['video','qa/original.webm','video/webm']]){
      const item=render(expression,{id:'synthetic',type,media_url:null,media_bucket:'chat-media',media_path:path,media_metadata:{mime_type:mime}});
      assert.equal(item.fileName,path.split('/').at(-1));assert.equal(item.mimeType,mime);assert.equal(typeof item.resolveSourceUrl,'function');
    }
  });
  test(`${file}: omission control rejects the old HTTP-only admission`,()=>{
    const mutant=expression.replace('(openMediaUrl || offeredMediaUrl)','offeredMediaUrl');
    assert.notEqual(mutant,expression,'unique admission mutation');
    assert.equal(render(mutant),null);
  });
}
