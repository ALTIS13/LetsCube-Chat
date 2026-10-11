const { readFileSync } = require("node:fs");
const ts = require("typescript");

const unwrap = node => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };
const id = node => node && ts.isIdentifier(unwrap(node)) ? unwrap(node).text : null;
const literal = node => node && ts.isStringLiteralLike(unwrap(node)) ? unwrap(node).text : null;
const field = (node, key, receiver) => {
  node = unwrap(node);
  return node && ts.isPropertyAccessExpression(node) && node.name.text === key
    && (receiver === undefined || id(node.expression) === receiver);
};
const fn = node => { node = unwrap(node); return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : null; };
const prop = (node, key) => node.properties.find(p => ts.isPropertyAssignment(p)
  && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === key)?.initializer;
function ownNodes(body, match) {
  const found = [];
  const visit = node => { if (match(node)) found.push(node); ts.forEachChild(node, child => { if (!ts.isFunctionLike(child)) visit(child); }); };
  visit(body); return found;
}
function updateBody(f) {
  if (!f || f.parameters.length !== 1) return null;
  const previous = id(f.parameters[0].name), body = unwrap(f.body);
  if (!previous || !ts.isConditionalExpression(body) || id(body.whenFalse) !== previous) return null;
  return { previous, value: unwrap(body.whenTrue) };
}
function incoming(callback) {
  if (!callback || callback.parameters.length !== 1) return null;
  const payload = id(callback.parameters[0].name);
  const rows = ownNodes(callback.body, node => ts.isVariableDeclaration(node) && id(node.name) && field(node.initializer, "new", payload));
  return rows.length === 1 ? id(rows[0].name) : null;
}
function event(call, kind) {
  const args = call?.arguments, object = args?.[1];
  return call && ts.isCallExpression(call) && field(call.expression, "on") && args.length === 3
    && literal(args[0]) === "postgres_changes" && object && ts.isObjectLiteralExpression(object)
    && literal(prop(object, "event")) === kind && literal(prop(object, "schema")) === "public"
    && literal(prop(object, "table")) === "notifications";
}
const singleton = (node, value) => { node = unwrap(node); return node && ts.isArrayLiteralExpression(node) && node.elements.length === 1 && id(node.elements[0]) === value; };
const number = (node, value) => node && ts.isNumericLiteral(unwrap(node)) && Number(unwrap(node).text) === value;
function classify(update) {
  const callback = fn(update.arguments[2]), row = incoming(callback);
  if (!row) return null;
  const calls = ownNodes(callback.body, node => ts.isCallExpression(node) && fn(node.arguments[0]));
  if (calls.length !== 1 || calls[0].arguments.length !== 1 || !id(calls[0].expression)) return null;
  const setter = id(calls[0].expression), state = updateBody(fn(calls[0].arguments[0]));
  const map = state?.value;
  if (!map || !ts.isCallExpression(map) || !field(map.expression, "map", state.previous) || map.arguments.length !== 1) return null;
  const mapper = fn(map.arguments[0]), existing = mapper?.parameters.length === 1 && id(mapper.parameters[0].name);
  const conditional = unwrap(mapper?.body), comparison = unwrap(conditional?.condition);
  if (!existing || !conditional || !ts.isConditionalExpression(conditional) || id(conditional.whenFalse) !== existing
    || !comparison || !ts.isBinaryExpression(comparison) || comparison.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    || !field(comparison.left, "id", existing) || !field(comparison.right, "id", row)) return null;
  // Associate the merge identifier with this same channel's INSERT state consumer,
  // so renaming works without treating an arbitrary three-argument call as a merge.
  const insert = unwrap(unwrap(update.expression).expression);
  if (!event(insert, "INSERT")) return null;
  const inserted = fn(insert.arguments[2]), insertedRow = incoming(inserted);
  if (!insertedRow) return null;
  const setters = ownNodes(inserted.body, node => ts.isCallExpression(node) && id(node.expression) === setter && node.arguments.length === 1);
  if (setters.length !== 1) return null;
  const insertState = updateBody(fn(setters[0].arguments[0])), merge = insertState?.value;
  if (!merge || !ts.isCallExpression(merge) || !id(merge.expression) || merge.arguments.length !== 3
    || id(merge.arguments[0]) !== insertState.previous || !singleton(merge.arguments[1], insertedRow)) return null;
  const branch = unwrap(conditional.whenTrue);
  if (id(branch) === row) return "old";
  if (!branch || !ts.isElementAccessExpression(branch) || !number(branch.argumentExpression, 0)) return null;
  const call = unwrap(branch.expression);
  return call && ts.isCallExpression(call) && id(call.expression) === id(merge.expression) && call.arguments.length === 3
    && singleton(call.arguments[0], existing) && singleton(call.arguments[1], row) && number(call.arguments[2], 1) ? "new" : null;
}
function notificationReadUpdateMarker(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 33554432) throw Error("NOTIFICATION_READ_UPDATE_JS_PARSE_REFUSED");
  const tree = ts.createSourceFile("bundle.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length) throw Error("NOTIFICATION_READ_UPDATE_JS_PARSE_REFUSED");
  const consumers = [];
  const visit = node => { if (event(node, "UPDATE")) consumers.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  if (consumers.length !== 1) throw Error("NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE");
  const kind = classify(consumers[0]);
  if (!kind) throw Error("NOTIFICATION_READ_UPDATE_CONSUMER_NOT_UNIQUE");
  return { schema: "notification-read-update-consumer/v1", oldConsumerCount: kind === "old" ? 1 : 0, newConsumerCount: kind === "new" ? 1 : 0 };
}
exports.notificationReadUpdateMarker = notificationReadUpdateMarker;
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error("NOTIFICATION_READ_UPDATE_PATH_REQUIRED");
    console.log(JSON.stringify(notificationReadUpdateMarker(readFileSync(process.argv[2], "utf8"))));
  } catch { console.error("NOTIFICATION_READ_UPDATE_MARKER_REFUSED"); process.exitCode = 1; }
}
