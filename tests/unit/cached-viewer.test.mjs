import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

for (const file of ['ChatWindow','ChatInfoPanel']) {
  const source=await readFile(new URL(`../../artifacts/kub/src/components/chat/${file}.tsx`,import.meta.url),'utf8');
  const tree=ts.createSourceFile(file+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='openMediaItem') expression=node.initializer.getText(tree);ts.forEachChild(node,visit);}
  visit(tree); assert.ok(expression,'actual mounted viewer initializer');
  const render = text => {
    const code=ts.transpileModule('return '+text+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    return new Function('openMediaRow','openMediaUrl','offeredMediaUrl','mediaOriginality','isUncompressedMedia',code)(
      {id:'synthetic',type:'image',content:'Synthetic'},'blob:cached-original',null,()=> 'unknown',()=>false);
  };
  test(`${file}: cold signed-only viewer accepts a cached Blob without a network address`,()=>{
    assert.equal(render(expression)?.url,'blob:cached-original');
    assert.equal(render(expression)?.loading,false);
  });
  test(`${file}: omission control rejects the old HTTP-only admission`,()=>{
    const mutant=expression.replace('(openMediaUrl || offeredMediaUrl)','offeredMediaUrl');
    assert.notEqual(mutant,expression,'unique admission mutation');
    assert.equal(render(mutant),null);
  });
}
