// Scripted JVM API doubles only: NOT Android AtomicFile, CE isolation or crash durability.
export const atomicStubs = {
  "android/content/Context.java": `package android.content;
import java.io.File;
public abstract class Context {
  public static final String USER_SERVICE = "user";
  public abstract boolean isDeviceProtectedStorage();
  public abstract Context getApplicationContext();
  public abstract File getNoBackupFilesDir();
  public abstract Object getSystemService(String name);
}`,
  "android/os/UserManager.java": `package android.os;
public class UserManager {
  public boolean unlocked = true;
  public boolean isUserUnlocked() { return unlocked; }
}`,
  "android/system/ErrnoException.java": `package android.system;
public class ErrnoException extends Exception {
  public final int errno;
  public ErrnoException(int errno) { super("FIXTURE"); this.errno = errno; }
}`,
  "android/system/StructStat.java": `package android.system;
public class StructStat {
  public final int st_mode;
  public StructStat(int mode) { st_mode = mode; }
}`,
  "android/system/OsConstants.java": `package android.system;
public final class OsConstants {
  public static final int ENOENT = 2, ENOTDIR = 20;
  public static boolean S_ISLNK(int mode) { return mode == 3; }
  public static boolean S_ISDIR(int mode) { return mode == 2; }
  public static boolean S_ISREG(int mode) { return mode == 1; }
}`,
  "android/system/Os.java": `package android.system;
import java.nio.file.*;
public final class Os {
  public static StructStat lstat(String name) throws ErrnoException {
    Path path = Paths.get(name);
    if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) throw new ErrnoException(2);
    if (Files.isSymbolicLink(path)) return new StructStat(3);
    if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) return new StructStat(2);
    if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) return new StructStat(1);
    return new StructStat(4);
  }
}`,
  "android/util/AtomicFile.java": `package android.util;
import java.io.*;
import java.nio.file.*;
public class AtomicFile {
  public static int reads, starts, finishes, fails;
  public static boolean startThrows, finishThrows, failThrows;
  public static TrackedStream last;
  private final File base;
  public AtomicFile(File base) { this.base = base; }
  public FileInputStream openRead() throws FileNotFoundException {
    reads++; return new FileInputStream(base);
  }
  public FileOutputStream startWrite() throws IOException {
    starts++;
    if (startThrows) throw new IOException("PRIVATE_FIXTURE_PATH");
    last = new TrackedStream(new File(base.getPath() + ".new")); return last;
  }
  public void finishWrite(FileOutputStream stream) {
    finishes++;
    if (finishThrows) throw new IllegalStateException("PRIVATE_FIXTURE_PATH");
    try {
      stream.close();
      Files.move(new File(base.getPath() + ".new").toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
    } catch (IOException failure) { throw new IllegalStateException("PRIVATE_FIXTURE_PATH"); }
  }
  public void failWrite(FileOutputStream stream) {
    fails++;
    if (failThrows) throw new IllegalStateException("PRIVATE_FIXTURE_PATH");
    try { stream.close(); Files.deleteIfExists(new File(base.getPath() + ".new").toPath()); }
    catch (IOException failure) { throw new IllegalStateException("PRIVATE_FIXTURE_PATH"); }
  }
  public static class TrackedStream extends FileOutputStream {
    public int flushes, closes;
    public TrackedStream(File file) throws FileNotFoundException { super(file); }
    @Override public void flush() throws IOException { flushes++; super.flush(); }
    @Override public void close() throws IOException { closes++; super.close(); }
  }
}`,
};
