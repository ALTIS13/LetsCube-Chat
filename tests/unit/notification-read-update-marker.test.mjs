import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { notificationReadUpdateMarker as legacyMarker } from "../e2e/helpers/notificationReadUpdateMarker.cjs";

const path=new URL("../../artifacts/kub/src/hooks/useNotifications.ts",import.meta.url);
const bytes=readFileSync(path),source=bytes.toString().replaceAll("\r\n","\n");
const current={schema:"notification-feed-read-consumer/v2",legacyRawCount:0,sidecarCount:1,revisionConsumerCount:1};
const req=createRequire(new URL("../../artifacts/kub/package.json",import.meta.url));
const esbuild=createRequire(req.resolve("vite"))("esbuild");
function compile(text){
  const out=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);return out.outputText;
}
const minify=text=>esbuild.transformSync(compile(text),{loader:"js",minify:true,target:"es2022"}).code;
function once(text,from,to){assert.equal(text.split(from).length,2);return text.replace(from,to);}
const unwrap=node=>{while(node&&ts.isParenthesizedExpression(node))node=node.expression;return node;};
const id=node=>node&&ts.isIdentifier(unwrap(node))?unwrap(node).text:null;
const literal=node=>node&&ts.isStringLiteralLike(unwrap(node))?unwrap(node).text:null;
const field=(node,name)=>node&&ts.isPropertyAccessExpression(unwrap(node))&&unwrap(node).name.text===name;
const prop=(node,name)=>node.properties.find(p=>p.name?.getText()===name);
const value=p=>p&&ts.isShorthandPropertyAssignment(p)?p.name:p?.initializer;
function find(root,predicate){const out=[];const visit=node=>{if(predicate(node))out.push(node);ts.forEachChild(node,visit);};visit(root);return out;}
const demand=value=>{if(!value)throw Error("NOTIFICATION_FEED_V2_CONSUMER_NOT_UNIQUE");};
// Wiring marker only: mounted read/ownership tests separately prove behavior.
// Follow actual import aliases, receiver and state setter after minification.
function marker(text){
  const tree=ts.createSourceFile("bundle.js",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(tree.parseDiagnostics.length)throw Error("NOTIFICATION_FEED_V2_JS_PARSE_REFUSED");
  const imported=name=>find(tree,n=>ts.isImportSpecifier(n)&&(n.propertyName??n.name).text===name).map(n=>n.name.text);
  const factories=imported("createNotificationFeedV2"),states=imported("useState");demand(factories.length===1);
  const calls=find(tree,n=>ts.isCallExpression(n)&&id(n.expression)===factories[0]);demand(calls.length===1);
  const [owner,ports]=calls[0].arguments;demand(ts.isObjectLiteralExpression(owner)&&ts.isObjectLiteralExpression(ports));
  const user=id(value(prop(owner,"userId"))),subscribe=prop(ports,"subscribe"),rows=prop(ports,"onRows");
  demand(subscribe&&ts.isMethodDeclaration(subscribe)&&rows&&ts.isMethodDeclaration(rows));
  const receive=id(subscribe.parameters[0].name),status=id(subscribe.parameters[1].name);
  const on=find(subscribe,n=>ts.isCallExpression(n)&&field(n.expression,"on"));demand(on.length===1);
  const call=on[0],filter=call.arguments[1],callback=call.arguments[2];
  demand(literal(call.arguments[0])==="postgres_changes"&&ts.isObjectLiteralExpression(filter)
    &&literal(value(prop(filter,"event")))==="INSERT"&&literal(value(prop(filter,"schema")))==="public"
    &&literal(value(prop(filter,"table")))==="notification_feed_events_v2");
  const scope=value(prop(filter,"filter"));
  demand(scope&&ts.isTemplateExpression(scope)&&scope.head.text==="recipient_id=eq."
    &&scope.templateSpans.length===1&&id(scope.templateSpans[0].expression)===user);
  demand(callback&&ts.isArrowFunction(callback)&&callback.parameters.length===1);
  const body=unwrap(callback.body);
  demand(ts.isCallExpression(body)&&id(body.expression)===receive&&body.arguments.length===1
    &&field(body.arguments[0],"new")&&id(body.arguments[0].expression)===id(callback.parameters[0].name));
  demand(find(subscribe,n=>ts.isCallExpression(n)&&field(n.expression,"subscribe")&&id(n.arguments[0])===status).length===1);
  const rowArg=id(rows.parameters[0].name);
  const mapped=find(rows,n=>ts.isVariableDeclaration(n)&&n.initializer&&ts.isCallExpression(n.initializer)
    &&field(n.initializer.expression,"map")&&id(n.initializer.expression.expression)===rowArg);
  demand(mapped.length===1);
  const transform=mapped[0].initializer.arguments[0],output=unwrap(transform?.body);
  demand(transform&&ts.isArrowFunction(transform)&&output&&ts.isObjectLiteralExpression(output)&&output.properties.length===2
    &&ts.isSpreadAssignment(output.properties[0])&&id(output.properties[0].expression)===id(transform.parameters[0].name)
    &&value(prop(output,"alert_origin"))?.kind===ts.SyntaxKind.NullKeyword);
  const state=find(tree,n=>ts.isVariableDeclaration(n)&&ts.isArrayBindingPattern(n.name)&&n.initializer&&ts.isCallExpression(n.initializer)
    &&states.includes(id(n.initializer.expression))&&n.initializer.arguments[0]&&ts.isArrayLiteralExpression(n.initializer.arguments[0]));
  demand(state.length===1);
  const setter=id(state[0].name.elements[1].name),next=id(mapped[0].name);
  const displayed=find(rows,n=>ts.isVariableDeclaration(n)&&n.initializer&&ts.isCallExpression(n.initializer)
    &&field(n.initializer.expression,"current")&&id(n.initializer.arguments[0])===next);
  demand(displayed.length===1);
  const visible=id(displayed[0].name);
  const guards=find(rows,n=>ts.isIfStatement(n)&&ts.isPrefixUnaryExpression(n.expression)
    &&n.expression.operator===ts.SyntaxKind.ExclamationToken&&ts.isCallExpression(n.expression.operand)
    &&ts.isReturnStatement(n.thenStatement));
  demand(guards.length===1);
  const guard=id(guards[0].expression.operand.expression);
  demand(guard&&find(rows,n=>{
    if(!ts.isCallExpression(n)||id(n.expression)!==setter||!n.arguments[0]||!ts.isArrowFunction(n.arguments[0]))return false;
    const update=n.arguments[0],body=unwrap(update.body),previous=id(update.parameters[0]?.name);
    return previous&&ts.isConditionalExpression(body)&&ts.isCallExpression(body.condition)
      &&id(body.condition.expression)===guard&&id(body.whenTrue)===visible&&id(body.whenFalse)===previous;
  }).length===1);
  demand(find(tree,n=>ts.isCallExpression(n)&&field(n.expression,"on")&&n.arguments[1]&&ts.isObjectLiteralExpression(n.arguments[1])
    &&literal(value(prop(n.arguments[1],"table")))==="notifications").length===0);
  return current;
}
test.after(()=>assert.ok(bytes.equals(readFileSync(path)),"frozen source unchanged during marker controls"));
test("calibration actual v2 hook is distinct from the retired legacy UPDATE marker",()=>{
  assert.deepEqual(marker(compile(source)),current);
  assert.throws(()=>legacyMarker(compile(source)),/NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE/);
});
test("actual full hook minification preserves v2 receiver/controller/setter association",()=>assert.deepEqual(marker(minify(source)),current));
test("wrong event/table/schema/filter and disconnected receiver cannot be counted",()=>{
  for(const bad of [
    once(source,'event: "INSERT", schema: "public", table: "notification_feed_events_v2"','event: "UPDATE", schema: "public", table: "notification_feed_events_v2"'),
    once(source,'table: "notification_feed_events_v2"','table: "notifications"'),
    once(source,'event: "INSERT", schema: "public"','event: "INSERT", schema: "private"'),
    once(source,'filter: '+String.fromCharCode(96)+'recipient_id=eq.'+'$'+'{userId}'+String.fromCharCode(96),'filter: "recipient_id=eq.other"'),
    once(source,'payload => receive(payload.new)','payload => other(payload.new)'),
  ])for(const text of [compile(bad),minify(bad)])assert.throws(()=>marker(text),/NOTIFICATION_FEED_V2_CONSUMER_NOT_UNIQUE/);
});
test("missing row association or fabricated read metadata cannot masquerade as a versioned consumer",()=>{
  for(const bad of [
    once(source,'rows.map(row => ({ ...row, alert_origin: null }))','otherRows.map(row => ({ ...row, alert_origin: null }))'),
    once(source,'rows.map(row => ({ ...row, alert_origin: null }))','rows.map(row => ({ ...row, alert_origin: null, read_at: "synthetic" }))'),
    once(source,'setItems(previous => current() ? visible : previous)','otherSetter(previous => current() ? visible : previous)'),
    once(source,'const visible = displayRef.current(next)','const visible = displayRef.current(other)'),
    once(source,'setItems(previous => current() ? visible : previous)','setItems(previous => visible)'),
  ])for(const text of [compile(bad),minify(bad)])assert.throws(()=>marker(text),/NOTIFICATION_FEED_V2_CONSUMER_NOT_UNIQUE/);
});
test("read_at and protocol text noise cannot inflate markers; duplicate consumers and malformed JS refuse",()=>{
  const noise='\nconst unrelated="postgres_changes INSERT notification_feed_events_v2 read_at onRows";\n';
  assert.deepEqual(marker(minify(source)+noise),current);
  assert.throws(()=>marker(noise),/NOTIFICATION_FEED_V2_CONSUMER_NOT_UNIQUE/);
  assert.throws(()=>marker(compile(source)+compile(source)),/NOTIFICATION_FEED_V2_CONSUMER_NOT_UNIQUE/);
  assert.throws(()=>marker("function {"),/NOTIFICATION_FEED_V2_JS_PARSE_REFUSED/);
});
