const { readFileSync } = require("node:fs");
const ts = require("typescript");

const unwrap = node => {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};
const id = node => node && ts.isIdentifier(unwrap(node)) ? unwrap(node).text : null;
const field = (node, name, receiver) => {
  node = unwrap(node);
  return node && ts.isPropertyAccessExpression(node) && node.name.text === name
    && (receiver === undefined || id(node.expression) === receiver);
};
const current = node => field(node, "current") ? id(unwrap(node).expression) : null;
const name = node => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
const property = (object, key) => object.properties.find(n => ts.isPropertyAssignment(n) && name(n.name) === key)?.initializer;
const fn = node => {
  node = unwrap(node);
  if (node && ts.isCallExpression(node)) node = unwrap(node.arguments[0]);
  return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : null;
};
function owner(node) {
  for (node = node.parent; node; node = node.parent) if (ts.isFunctionLike(node)) return node;
  return null;
}
function walk(node, visit, skipFunctions = false) {
  if (!node) return;
  visit(node);
  ts.forEachChild(node, child => { if (!skipFunctions || !ts.isFunctionLike(child)) walk(child, visit, skipFunctions); });
}
const nodes = (body, match) => {
  const result = [];
  walk(body, n => { if (match(n)) result.push(n); }, true);
  return result;
};
function bool(node) {
  node = unwrap(node);
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node && ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken
    && ts.isNumericLiteral(unwrap(node.operand))) return Number(unwrap(node.operand).text) === 0;
  return null;
}
function requiresInactive(node, ref) {
  node = unwrap(node);
  if (node && ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return current(node.operand) === ref;
  if (!node || !ts.isBinaryExpression(node)) return false;
  if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) return requiresInactive(node.right, ref);
  return node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    && (requiresInactive(node.left, ref) || requiresInactive(node.right, ref));
}
const bareReturn = node => ts.isReturnStatement(node) ? !node.expression
  : ts.isBlock(node) && node.statements.length === 1 && ts.isReturnStatement(node.statements[0]) && !node.statements[0].expression;

function classify(pointer, bindings, constants) {
  if (!ts.isBlock(pointer.body) || pointer.parameters.length !== 1) return null;
  const event = id(pointer.parameters[0].name);
  if (!event) return null;
  const all = nodes(pointer.body, () => true);
  const calls = all.filter(ts.isCallExpression);
  const conditions = all.filter(ts.isIfStatement);
  const hasComparison = (expression, key, literal, operator) => nodes(expression, n => ts.isBinaryExpression(n)
    && n.operatorToken.kind === operator && field(n.left, key, event)
    && (ts.isStringLiteral(unwrap(n.right)) || ts.isNumericLiteral(unwrap(n.right))) && unwrap(n.right).text === literal).length > 0;
  if (!conditions.some(n => hasComparison(n.expression, "button", "0", ts.SyntaxKind.ExclamationEqualsEqualsToken))
    || !conditions.some(n => hasComparison(n.expression, "pointerType", "touch", ts.SyntaxKind.EqualsEqualsEqualsToken))) return null;
  const prevent = calls.filter(n => field(n.expression, "preventDefault", event) && n.arguments.length === 0);
  const capture = calls.filter(n => field(n.expression, "setPointerCapture")
    && field(unwrap(n.expression).expression, "currentTarget", event)
    && n.arguments.length === 1 && field(n.arguments[0], "pointerId", event));
  const replacements = all.filter(n => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && current(n.left) && nodes(n.right, r => field(r, "clientX", event) || field(r, "clientY", event) || field(r, "pointerId", event)).length);
  if (prevent.length !== 1 || capture.length !== 1 || replacements.length < 2) return null;
  const firstReplacement = Math.min(...replacements.map(n => n.getStart()), capture[0].getStart());
  if (prevent[0].getEnd() >= firstReplacement) return null;
  const timers = calls.filter(n => id(n.expression) === "setTimeout" && fn(n.arguments[0]) && n.arguments.length === 2
    && (ts.isNumericLiteral(unwrap(n.arguments[1])) ? Number(unwrap(n.arguments[1]).text) : constants.get(id(n.arguments[1]))) === 320);
  if (timers.length !== 1) return null;
  const timerAssignments = all.filter(n => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && current(n.left) && unwrap(n.right) === timers[0]);
  if (timerAssignments.length !== 1) return null;
  const timerRef = current(timerAssignments[0].left);
  const timerCalls = nodes(fn(timers[0].arguments[0]).body, ts.isCallExpression);
  const starts = calls.filter(n => id(n.expression) && bindings.has(id(n.expression)) && n.arguments.length === 1
    && timerCalls.some(t => id(t.expression) === id(n.expression) && t.arguments.length === 1 && id(t.arguments[0]) === id(n.arguments[0])));
  if (starts.length !== 1) return null;
  const bridge = fn(bindings.get(id(starts[0].expression)).initializer);
  if (!bridge) return null;
  const voice = [];
  for (const call of nodes(bridge.body, ts.isCallExpression)) {
    const declaration = bindings.get(id(call.expression));
    const start = declaration && fn(declaration.initializer);
    if (!start?.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) continue;
    const awaits = nodes(start.body, n => ts.isAwaitExpression(n) && ts.isCallExpression(unwrap(n.expression))
      && field(unwrap(n.expression).expression, "start") && unwrap(n.expression).arguments.length === 0);
    if (awaits.length !== 1) continue;
    const recorder = id(unwrap(unwrap(awaits[0].expression).expression).expression);
    const recorderInit = unwrap(bindings.get(recorder)?.initializer);
    if (!recorderInit || !ts.isCallExpression(recorderInit) || recorderInit.arguments.length !== 0) continue;
    const assignments = nodes(start.body, n => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && current(n.left) && bool(n.right) === true && n.getEnd() < awaits[0].getStart());
    for (const assignment of assignments) {
      const ref = current(assignment.left), init = unwrap(bindings.get(ref)?.initializer);
      if (init && ts.isCallExpression(init) && init.arguments.length === 1 && bool(init.arguments[0]) === false) voice.push(ref);
    }
  }
  if (voice.length !== 1) return null;
  const ref = voice[0];
  const guards = conditions.filter(n => {
    const cleanup = ts.isExpressionStatement(n.thenStatement) && unwrap(n.thenStatement.expression);
    const timerCleanup = current(n.expression) === timerRef && !n.elseStatement && cleanup && ts.isCallExpression(cleanup)
      && id(cleanup.expression) === "clearTimeout" && cleanup.arguments.length === 1 && current(cleanup.arguments[0]) === timerRef;
    return !timerCleanup && nodes(n.expression, r => current(r)).length > 0;
  });
  if (guards.length === 0) return "old";
  if (guards.length !== 1) return null;
  const guard = guards[0], reads = nodes(guard.expression, n => current(n));
  if (reads.length !== 1 || current(reads[0]) !== ref || reads[0].getEnd() >= firstReplacement) return null;
  // Both emitted early-return and minified positive-if must gate the whole setup.
  const earlyReturn = current(guard.expression) === ref && bareReturn(guard.thenStatement)
    && !guard.elseStatement && guard.getStart() > prevent[0].getEnd() && guard.getEnd() < firstReplacement
    && guard.parent === pointer.body;
  const positiveIf = requiresInactive(guard.expression, ref) && replacements.every(n => n.getStart() >= guard.thenStatement.getStart()
    && n.getEnd() <= guard.thenStatement.getEnd()) && capture[0].getStart() >= guard.thenStatement.getStart()
    && capture[0].getEnd() <= guard.thenStatement.getEnd();
  return earlyReturn || positiveIf ? "new" : null;
}

function voiceAcquisitionMarker(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 33554432) throw new Error("VOICE_ACQUISITION_JS_PARSE_REFUSED");
  const tree = ts.createSourceFile("bundle.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length) throw new Error("VOICE_ACQUISITION_JS_PARSE_REFUSED");
  const scopes = new Map(), constants = new Map(), buttons = [];
  walk(tree, node => {
    if (ts.isVariableDeclaration(node) && id(node.name)) {
      const scope = owner(node);
      if (!scopes.has(scope)) scopes.set(scope, new Map());
      scopes.get(scope).set(id(node.name), node);
      if (!scope && node.initializer && ts.isNumericLiteral(unwrap(node.initializer))) constants.set(id(node.name), Number(unwrap(node.initializer).text));
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "button"
      && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const props = node.arguments[1], testId = property(props, "data-testid");
      if (testId && ts.isStringLiteral(testId) && testId.text === "composer-recorder-button") buttons.push({scope:owner(node), handler:id(property(props, "onPointerDown"))});
    }
  });
  const consumers = new Map();
  for (const button of buttons) {
    const bindings = scopes.get(button.scope), declaration = bindings?.get(button.handler);
    if (declaration && fn(declaration.initializer)) consumers.set(declaration, bindings);
  }
  if (consumers.size !== 1 || buttons.some(b => !scopes.get(b.scope)?.has(b.handler))) throw new Error("VOICE_ACQUISITION_CONSUMER_NOT_UNIQUE");
  const [declaration, bindings] = [...consumers][0];
  const kind = classify(fn(declaration.initializer), bindings, constants);
  if (!kind) throw new Error("VOICE_ACQUISITION_CONSUMER_NOT_UNIQUE");
  return { schema: "voice-acquisition-consumer/v1", oldConsumerCount: kind === "old" ? 1 : 0, newConsumerCount: kind === "new" ? 1 : 0 };
}
exports.voiceAcquisitionMarker = voiceAcquisitionMarker;

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error("VOICE_ACQUISITION_BUNDLE_PATH_REQUIRED");
    console.log(JSON.stringify(voiceAcquisitionMarker(readFileSync(process.argv[2], "utf8"))));
  } catch {
    console.error("VOICE_ACQUISITION_MARKER_REFUSED");
    process.exitCode = 1;
  }
}
