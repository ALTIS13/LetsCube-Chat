import assert from "node:assert/strict";
import { initializerStubs } from "../../android/message-preview-pristine-initializer-stubs.fixture.mjs";

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, "exact inherited fixture site");
  return text.replace(before, after);
}

// Reuse Android doubles and real JVM files. Extra events model failure/held API returns,
// not Android AtomicFile recovery, CE custody or power-loss durability.
let atomic = initializerStubs["android/util/AtomicFile.java"];
atomic = replaceOnce(atomic, "public static boolean startThrows, finishThrows, failThrows;",
  "public static boolean startThrows, finishThrows, failThrows, writeThrows, flushThrows;");
atomic = replaceOnce(atomic,
  "Files.move(new File(base.getPath() + \".new\").toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);",
  "Files.move(new File(base.getPath() + \".new\").toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING); event(\"journal-committed\");");
atomic = replaceOnce(atomic,
  "@Override public void flush() throws IOException { flushes++; super.flush(); }",
  `@Override public void write(byte[] bytes) throws IOException {
      if (writeThrows) throw new IOException("FIXTURE_WRITE"); super.write(bytes);
    }
    @Override public void flush() throws IOException {
      flushes++; event("journal-flush");
      if (flushThrows) throw new IOException("FIXTURE_FLUSH"); super.flush();
    }`);

const clock = replaceOnce(initializerStubs["android/os/SystemClock.java"],
  "public static long elapsedRealtime() { return value; }",
  "public static java.util.function.LongSupplier onRead;\n  public static long elapsedRealtime() { return onRead == null ? value : onRead.getAsLong(); }");
export const transitionStubs = { ...initializerStubs, "android/util/AtomicFile.java": atomic, "android/os/SystemClock.java": clock };
