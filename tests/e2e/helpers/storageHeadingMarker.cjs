const { readFileSync } = require("node:fs");
const ts = require("typescript");

const title = "Хранилище приложения";
const oldClass = "flex flex-wrap items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]";
const newClass = "flex items-center gap-x-1.5 text-sm text-[color:var(--kub-text)]";

const property = (object, name) => object.properties.find(node =>
  ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === name,
)?.initializer;
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : null;
const props = node => node && ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
  ? node.arguments[1] : null;

// JSX-runtime callee names may be minified. The tag/props/children contract may not.
function storageHeadingMarker(source) {
  const tree = ts.createSourceFile("bundle.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length) throw new Error("STORAGE_HEADING_JS_PARSE_REFUSED");
  let oldConsumerCount = 0;
  let newConsumerCount = 0;
  const visit = node => {
    const object = props(node);
    if (object && literal(node.arguments[0]) === "div") {
      const children = property(object, "children");
      if (children && ts.isArrayLiteralExpression(children) && children.elements.length === 2) {
        const [label, hint] = children.elements;
        const hintProps = props(hint);
        const hintMatches = hintProps && literal(property(hintProps, "term")) === title
          && literal(property(hintProps, "text"))?.startsWith("Папка на диске, где LETSCUBE держит переписку,");
        const className = literal(property(object, "className"));
        if (hintMatches && className === oldClass && literal(label) === title) oldConsumerCount++;
        const labelProps = props(label);
        if (hintMatches && className === newClass && labelProps && literal(label.arguments[0]) === "span"
          && literal(property(labelProps, "className")) === "min-w-0"
          && literal(property(labelProps, "children")) === title) newConsumerCount++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { schema: "storage-heading-consumer/v1", oldConsumerCount, newConsumerCount };
}

exports.storageHeadingMarker = storageHeadingMarker;

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error("STORAGE_HEADING_BUNDLE_PATH_REQUIRED");
    const marker = storageHeadingMarker(readFileSync(process.argv[2], "utf8"));
    console.log(JSON.stringify(marker));
    if (marker.oldConsumerCount + marker.newConsumerCount !== 1) throw new Error("STORAGE_HEADING_CONSUMER_NOT_UNIQUE");
  } catch {
    console.error("STORAGE_HEADING_MARKER_REFUSED");
    process.exitCode = 1;
  }
}
