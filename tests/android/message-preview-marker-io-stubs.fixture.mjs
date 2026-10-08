import { atomicStubs } from "./message-preview-atomic-stubs.fixture.mjs";

// Android policy/stat/directory-fsync doubles, real JVM marker files and file descriptors.
// Not Android CE/UID/mode/dir-sync/close-failure or crash-durability proof.
export const markerIOStubs = {
  ...atomicStubs,
  "android/content/Context.java": `package android.content;
import java.io.File;
import android.content.pm.ApplicationInfo;
public abstract class Context {
  public static final String USER_SERVICE = "user";
  public abstract boolean isDeviceProtectedStorage();
  public abstract Context getApplicationContext();
  public abstract File getNoBackupFilesDir();
  public abstract Object getSystemService(String name);
  public abstract ApplicationInfo getApplicationInfo();
}`,
  "android/content/pm/ApplicationInfo.java": `package android.content.pm;
public class ApplicationInfo { public int uid = 10123; }`,
  "android/os/Process.java": `package android.os;
public final class Process { public static int myUid() { return 10123; } }`,
  "android/os/Looper.java": `package android.os;
public final class Looper {
  private static final Thread MAIN = Thread.currentThread();
  private static final Looper INSTANCE = new Looper();
  public static Looper getMainLooper() { return INSTANCE; }
  public static Looper myLooper() { return Thread.currentThread() == MAIN ? INSTANCE : null; }
}`,
  "android/system/OsConstants.java": `package android.system;
public final class OsConstants {
  public static final int ENOENT=2, EEXIST=17, EACCES=13, ENOTDIR=20;
  public static final int O_RDONLY=0, O_WRONLY=1, O_CREAT=64, O_EXCL=128, O_NOFOLLOW=131072;
  public static boolean S_ISDIR(int mode) { return (mode & 0170000) == 0040000; }
  public static boolean S_ISREG(int mode) { return (mode & 0170000) == 0100000; }
  public static boolean S_ISLNK(int mode) { return (mode & 0170000) == 0120000; }
}`,
  "android/system/StructStat.java": `package android.system;
public final class StructStat {
  public final int st_mode, st_uid;
  public final long st_dev, st_ino, st_size;
  public StructStat(int mode, int uid, long inode, long size) {
    this(mode,uid,1,inode,size);
  }
  public StructStat(int mode, int uid, long dev, long inode, long size) {
    st_mode=mode; st_uid=uid; st_dev=dev; st_ino=inode; st_size=size;
  }
}`,
  "android/system/Os.java": `package android.system;
import java.io.*;
import java.nio.file.*;
import java.util.*;
public final class Os {
  public static final List<String> events = new ArrayList<>();
  public static java.util.function.Consumer<String> onEvent;
  public static String fail;
  public static boolean wrongDescriptor, nonemptyDescriptor;
  public static String directoryDescriptorFault, directoryFaultTarget;
  public static final Map<String,Integer> modes = new HashMap<>();
  public static final Map<String,Integer> owners = new HashMap<>();
  public static final Map<String,Integer> types = new HashMap<>();
  private static final Map<String,Long> identities = new HashMap<>();
  private static final Map<FileDescriptor,Handle> handles = new IdentityHashMap<>();
  private static long next = 1;
  private static final class Handle {
    final String path; final StructStat stat; final RandomAccessFile file;
    Handle(String path, StructStat stat, RandomAccessFile file) { this.path=path; this.stat=stat; this.file=file; }
  }
  private static void event(String name) throws ErrnoException {
    events.add(name);
    if (onEvent != null) onEvent.accept(name);
    if (name.equals(fail)) throw new ErrnoException(13);
  }
  public static StructStat lstat(String name) throws ErrnoException {
    event("lstat:" + new File(name).getName());
    Path path = Paths.get(name);
    if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) throw new ErrnoException(2);
    int type = Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) ? 0040000 : 0100000;
    if (Files.isSymbolicLink(path)) type=0120000;
    type=types.getOrDefault(name,type);
    long inode=identities.computeIfAbsent(name, ignored -> next++);
    try { return new StructStat(type | modes.getOrDefault(name,0700), owners.getOrDefault(name,10123), inode,
      type == 0100000 ? Files.size(path) : 0); }
    catch (IOException failure) { throw new ErrnoException(13); }
  }
  public static void mkdir(String name, int mode) throws ErrnoException {
    event("mkdir:" + mode);
    try { Files.createDirectory(Paths.get(name)); modes.put(name,mode); }
    catch (FileAlreadyExistsException failure) { throw new ErrnoException(17); }
    catch (IOException failure) { throw new ErrnoException(13); }
  }
  public static FileDescriptor open(String name, int flags, int mode) throws ErrnoException {
    event("open:" + new File(name).getName() + ":" + flags + ":" + mode);
    try {
      Path path=Paths.get(name);
      if ((flags & OsConstants.O_NOFOLLOW) != 0 && types.getOrDefault(name,0) == 0120000) throw new ErrnoException(13);
      if ((flags & OsConstants.O_CREAT) != 0) {
        if ((flags & OsConstants.O_EXCL) != 0) Files.createFile(path);
        else if (!Files.exists(path)) Files.createFile(path);
        modes.put(name,mode);
      }
      StructStat stat=lstat(name);
      // JVM cannot open directory FDs; this models public read-only open, not a directory-only flag.
      if (OsConstants.S_ISDIR(stat.st_mode)) {
        FileDescriptor fd=new FileDescriptor(); handles.put(fd,new Handle(name,stat,null)); return fd;
      }
      RandomAccessFile file=new RandomAccessFile(name,(flags & OsConstants.O_WRONLY) != 0 ? "rw" : "r");
      FileDescriptor fd=file.getFD(); handles.put(fd,new Handle(name,stat,file)); return fd;
    } catch (FileAlreadyExistsException failure) { throw new ErrnoException(17); }
    catch (IOException failure) { throw new ErrnoException(13); }
  }
  public static StructStat fstat(FileDescriptor fd) throws ErrnoException {
    Handle h=handles.get(fd); if (h == null) throw new ErrnoException(13);
    event("fstat:" + new File(h.path).getName());
    if (h.file == null && directoryDescriptorFault != null && new File(h.path).getName().equals(directoryFaultTarget)) {
      String fault=directoryDescriptorFault; directoryDescriptorFault=null;
      return new StructStat(fault.equals("type") ? 0100700 : fault.equals("mode") ? 0040755 : h.stat.st_mode,
        fault.equals("owner") ? 10124 : h.stat.st_uid, fault.equals("dev") ? 2 : h.stat.st_dev,
        fault.equals("inode") ? h.stat.st_ino+1 : h.stat.st_ino, 0);
    }
    if (h.file != null && !fd.valid()) throw new ErrnoException(13);
    if (h.file != null && wrongDescriptor) {
      wrongDescriptor=false;
      return new StructStat(h.stat.st_mode,h.stat.st_uid,h.stat.st_ino+1,0);
    }
    if (h.file != null && nonemptyDescriptor) {
      nonemptyDescriptor=false;
      try { h.file.write(7); h.file.seek(0); } catch(IOException failure) { throw new ErrnoException(13); }
    }
    return new StructStat(h.stat.st_mode,h.stat.st_uid,h.stat.st_ino,h.file == null ? 0 : lstat(h.path).st_size);
  }
  public static void fsync(FileDescriptor fd) throws ErrnoException {
    Handle h=handles.get(fd); if (h == null) throw new ErrnoException(13);
    event("fsync:" + new File(h.path).getName());
    if (h.file != null) try { fd.sync(); } catch(IOException failure) { throw new ErrnoException(13); }
  }
  public static void close(FileDescriptor fd) throws ErrnoException {
    Handle h=handles.remove(fd); if (h == null) throw new ErrnoException(13);
    try { if (h.file != null) h.file.close(); } catch(IOException failure) { throw new ErrnoException(13); }
    event("close:" + new File(h.path).getName());
  }
  public static void replaceIdentity(String name) { identities.put(name,next++); }
  public static void breakFiles() {
    for (Handle h : handles.values()) if (h.file != null) try { h.file.close(); }
      catch(IOException failure) { throw new AssertionError("FIXTURE_FD_CLOSE_FAILED"); }
  }
  public static void assertClosed() {
    for (Map.Entry<FileDescriptor,Handle> e : handles.entrySet()) {
      if (e.getValue().file == null || e.getKey().valid()) throw new AssertionError("OWN_HANDLES_CLOSED");
    }
  }
}`,
};
