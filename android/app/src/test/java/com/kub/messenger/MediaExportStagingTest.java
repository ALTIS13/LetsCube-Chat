package com.kub.messenger;

import static org.junit.Assert.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;
import org.junit.*;
import org.junit.rules.TemporaryFolder;

public class MediaExportStagingTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final AtomicLong clock = new AtomicLong(1000);
    private static final byte[] HELLO = new byte[]{104, 101, 108, 108, 111};
    private static final String HELLO_HASH = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    private Object stage;
    private File root;

    // Reflection keeps the absent-feature RED a JUnit assertion, not javac failure.
    private static Object invoke(Object object, String method, Class<?>[] types, Object... args) throws Exception {
        try { return object.getClass().getDeclaredMethod(method, types).invoke(object, args); }
        catch (InvocationTargetException e) {
            if (e.getCause() instanceof Exception) throw (Exception) e.getCause();
            throw (Error) e.getCause();
        }
    }
    private Object create(File directory) throws Exception {
        try { return Class.forName("com.kub.messenger.MediaExportStaging").getDeclaredConstructor(File.class, LongSupplier.class).newInstance(directory, (LongSupplier) clock::get); }
        catch (ClassNotFoundException e) { throw new AssertionError("Bounded media staging API is missing", e); }
        catch (InvocationTargetException e) { throw (Exception) e.getCause(); }
    }
    @Before public void setUp() throws Exception { root = temporary.newFolder("cache"); stage = create(root); }
    @After public void tearDown() throws Exception { if (stage != null) invoke(stage, "close", new Class<?>[0]); }
    private MediaExportSource source() throws Exception {
        return (MediaExportSource) MediaExportSource.class.getDeclaredMethod("local", String.class, String.class).invoke(null, "photo.png", "image/png");
    }
    private String begin(long size, String hash) throws Exception { return (String) invoke(stage, "begin", new Class<?>[]{MediaExportSource.class, long.class, String.class}, source(), size, hash); }
    private void append(String id, long offset, byte[] bytes) throws Exception { invoke(stage, "append", new Class<?>[]{String.class, long.class, byte[].class}, id, offset, bytes); }
    private Object finish(String id) throws Exception { return invoke(stage, "finish", new Class<?>[]{String.class}, id); }
    private void abort(String id) throws Exception { invoke(stage, "abort", new Class<?>[]{String.class}, id); }
    private List<Path> parts() throws Exception {
        List<Path> out = new ArrayList<>(); try (java.util.stream.Stream<Path> paths = Files.walk(root.toPath())) {
            paths.filter(p -> p.getFileName().toString().endsWith(".part")).forEach(out::add);
        } return out;
    }
    private interface Task { void run() throws Exception; }
    private void refused(Task action) throws Exception {
        try { action.run(); fail("Operation was not refused"); }
        catch (IOException | IllegalArgumentException | IllegalStateException expected) { }
    }
    private void empty() throws Exception { assertEquals(0, parts().size()); }
    private void closeCompleted(Object completed) throws Exception { invoke(completed, "close", new Class<?>[0]); }
    private static String hex(byte[] bytes) { StringBuilder s = new StringBuilder(); for (byte b : bytes) s.append(String.format("%02x", b & 255)); return s.toString(); }

    @Test public void streamsExactBytesAndMetadataThenCompletedClosesOwnedInputAndFile() throws Exception {
        String id = begin(5, HELLO_HASH); assertTrue(id.matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"));
        append(id, 0, new byte[]{104, 101}); append(id, 2, new byte[]{108, 108, 111});
        Object completed = finish(id); assertTrue(parts().size() >= 1 && parts().size() <= 2);
        MediaExportSource metadata = (MediaExportSource) invoke(completed, "source", new Class<?>[0]); assertNull(metadata.uri()); assertEquals("photo.png", metadata.fileName());
        InputStream in = (InputStream) invoke(completed, "openInput", new Class<?>[0]);
        byte[] bytes = new byte[5]; assertEquals(5, in.read(bytes)); assertArrayEquals(HELLO, bytes); assertEquals(-1, in.read());
        closeCompleted(completed); closeCompleted(completed); empty();
        refused(() -> in.read()); refused(() -> invoke(completed, "openInput", new Class<?>[0]));
        refused(() -> finish(id));
    }
    @Test public void literal32MiBMaximumAcceptedAndOneMoreRefused() throws Exception {
        refused(() -> begin(33554433L, HELLO_HASH)); empty();
        byte[] chunk = new byte[262144]; MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (int i = 0; i < 128; i++) digest.update(chunk);
        String id = begin(33554432L, hex(digest.digest()));
        for (int i = 0; i < 128; i++) append(id, (long) i * 262144, chunk);
        Object completed = finish(id); assertEquals(33554432L, Files.size(parts().get(0))); closeCompleted(completed); empty();
    }
    @Test public void literal256KiBChunkBoundaryAndDeclaredTotalEnforced() throws Exception {
        final String large = begin(262145, HELLO_HASH); refused(() -> append(large, 0, new byte[262145])); empty();
        final String shorter = begin(4, HELLO_HASH); refused(() -> append(shorter, 0, HELLO)); empty();
    }
    @Test public void duplicateSkippedNegativeAndEmptyChunksAbortOnlyTheirSession() throws Exception {
        for (long offset : new long[]{-1, 1, Long.MAX_VALUE}) { final String id = begin(5, HELLO_HASH); refused(() -> append(id, offset, HELLO)); empty(); }
        String duplicate = begin(5, HELLO_HASH); append(duplicate, 0, new byte[]{104}); refused(() -> append(duplicate, 0, new byte[]{101})); empty();
        for (byte[] bytes : new byte[][]{null, new byte[0]}) { final String id = begin(5, HELLO_HASH); refused(() -> append(id, 0, bytes)); empty(); }
    }
    @Test public void malformedUnknownAndConsumedTokensCannotDestroyCurrentSession() throws Exception {
        String old = begin(5, HELLO_HASH); abort(old); String id = begin(5, HELLO_HASH); Set<Path> held = new HashSet<>(parts());
        for (String wrong : new String[]{null, "", "../escape", "00000000-0000-4000-8000-000000000000", old}) {
            refused(() -> append(wrong, 0, HELLO)); refused(() -> finish(wrong)); refused(() -> abort(wrong)); assertEquals(held, new HashSet<>(parts()));
        }
        append(id, 0, HELLO); closeCompleted(finish(id)); empty();
    }
    @Test public void wrongHashAndTruncatedFinishNeverReturnCompletedAndRemovePart() throws Exception {
        String bad = begin(5, "0".repeat(64)); append(bad, 0, HELLO); refused(() -> finish(bad)); empty();
        String shortId = begin(5, HELLO_HASH); append(shortId, 0, new byte[]{104}); refused(() -> finish(shortId)); empty();
    }
    @Test public void invalidBeginMetadataSizeAndHashDoNotCreateFiles() throws Exception {
        for (long size : new long[]{0, -1, Long.MAX_VALUE}) refused(() -> begin(size, HELLO_HASH));
        for (String hash : new String[]{null, "", HELLO_HASH.toUpperCase(Locale.ROOT), "g".repeat(64), "0".repeat(63)}) refused(() -> begin(5, hash));
        MediaExportSource remote = MediaExportSource.parse("https://core.letscube.ru/storage/v1/object/public/chat-media/a.png", "photo.png");
        refused(() -> invoke(stage, "begin", new Class<?>[]{MediaExportSource.class, long.class, String.class}, remote, 5L, HELLO_HASH));
        refused(() -> invoke(stage, "begin", new Class<?>[]{MediaExportSource.class, long.class, String.class}, null, 5L, HELLO_HASH)); empty();
    }
    @Test public void oneSessionAndOutstandingCompletedBlockNewBeginUntilClose() throws Exception {
        String id = begin(5, HELLO_HASH); refused(() -> begin(5, HELLO_HASH)); append(id, 0, HELLO);
        Object completed = finish(id); refused(() -> begin(5, HELLO_HASH)); closeCompleted(completed);
        abort(begin(5, HELLO_HASH)); empty();
    }
    @Test public void expiresAtLiteral120000msButNot119999msAndDoesNotSlide() throws Exception {
        String live = begin(5, HELLO_HASH); clock.addAndGet(119999); append(live, 0, HELLO); closeCompleted(finish(live));
        clock.set(1000); String expired = begin(5, HELLO_HASH); clock.addAndGet(60000); append(expired, 0, new byte[]{104});
        clock.addAndGet(60000); refused(() -> append(expired, 1, new byte[]{101})); empty();
        clock.set(1000); String end = begin(5, HELLO_HASH); append(end, 0, HELLO); clock.addAndGet(120000); refused(() -> finish(end)); empty();
    }
    @Test public void backwardsClockFailsClosedAndUnknownTokenDoesNotExpireAnotherSession() throws Exception {
        String id = begin(5, HELLO_HASH); clock.set(999); refused(() -> finish(id)); empty();
        clock.set(1000); String partial = begin(5, HELLO_HASH); clock.set(50000); append(partial, 0, new byte[]{104});
        clock.set(49999); refused(() -> append(partial, 1, new byte[]{101})); empty();
        clock.set(1000); String expired = begin(5, HELLO_HASH); clock.set(121000);
        Set<Path> held = new HashSet<>(parts()); refused(() -> abort("00000000-0000-4000-8000-000000000000")); assertEquals(held, new HashSet<>(parts()));
        refused(() -> append(expired, 0, HELLO)); empty();
    }
    @Test public void finishHashesActualFileBytesNotOnlyPreviouslyAppendedChunks() throws Exception {
        String id = begin(5, HELLO_HASH); append(id, 0, HELLO);
        Files.write(parts().get(0), new byte[]{0, 0, 0, 0, 0}, StandardOpenOption.TRUNCATE_EXISTING);
        refused(() -> finish(id)); empty();
    }
    @Test public void abortAndManagerCloseRemoveOwnedFilesAndCloseIsUncheckedIdempotent() throws Exception {
        String id = begin(5, HELLO_HASH); append(id, 0, HELLO); abort(id); empty();
        String complete = begin(5, HELLO_HASH); append(complete, 0, HELLO); Object held = finish(complete);
        invoke(stage, "close", new Class<?>[0]); invoke(stage, "close", new Class<?>[0]); empty();
        refused(() -> begin(5, HELLO_HASH)); refused(() -> invoke(held, "openInput", new Class<?>[0]));
        assertEquals(0, stage.getClass().getDeclaredMethod("close").getExceptionTypes().length);
    }
    @Test public void startupCleansOnlyExactUuidPartFilesAndPreservesOtherFiles() throws Exception {
        String id = begin(5, HELLO_HASH); Path directory = parts().get(0).getParent(); abort(id); invoke(stage, "close", new Class<?>[0]); stage = null;
        Path stale = directory.resolve("11111111-1111-4111-8111-111111111111.part"); Files.write(stale, HELLO);
        Path note = directory.resolve("keep.part"), foreign = root.toPath().resolve("keep.txt"); Files.write(note, HELLO); Files.write(foreign, HELLO);
        stage = create(root); assertFalse(Files.exists(stale)); assertArrayEquals(HELLO, Files.readAllBytes(note)); assertArrayEquals(HELLO, Files.readAllBytes(foreign));
    }
    @Test public void secondManagerCannotCleanAnActiveManagersFile() throws Exception {
        String id = begin(5, HELLO_HASH); Set<Path> held = new HashSet<>(parts()); refused(() -> create(root)); assertEquals(held, new HashSet<>(parts())); append(id, 0, HELLO); closeCompleted(finish(id)); empty();
    }
    @Test public void replacedPartIsNotFollowedOrDeletedAndStorageFailureIsVisible() throws Exception {
        String id = begin(5, HELLO_HASH); Path part = parts().get(0).getParent().resolve(id + ".part"), kept = part.resolveSibling("preserved.bin");
        Files.move(part, kept); Files.write(part, HELLO); refused(() -> append(id, 0, HELLO));
        try { invoke(stage, "close", new Class<?>[0]); fail("Foreign replacement cleanup must fail visibly"); } catch (UncheckedIOException expected) { }
        assertArrayEquals(HELLO, Files.readAllBytes(part)); assertTrue(Files.exists(kept)); Files.delete(part);
    }
    @Test public void failedCleanupStillReleasesTheOwnerLockForRecovery() throws Exception {
        String id = begin(5, HELLO_HASH);
        Path part = parts().get(0).getParent().resolve(id + ".part");
        Files.move(part, part.resolveSibling("preserved-after-close.bin")); Files.write(part, HELLO);
        try { invoke(stage, "close", new Class<?>[0]); fail("Replacement must report cleanup failure"); }
        catch (UncheckedIOException expected) { }
        Files.delete(part);
        Object recovered = create(root);
        invoke(recovered, "close", new Class<?>[0]);
    }
    @Test public void nativeStagerNeverLinksTheAndroidForbiddenFileStoreProbe() throws Exception {
        try (InputStream input = stage.getClass().getResourceAsStream("MediaExportStaging.class")) {
            assertNotNull(input); ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            assertFalse("Android LinuxFileSystemProvider.getFileStore always throws SecurityException",
                new String(bytes.toByteArray(), java.nio.charset.StandardCharsets.ISO_8859_1).contains("getFileStore"));
        }
    }
    @Test public void completedInputCloseFailureStillAttemptsOwnedDeletion() throws Exception {
        String id = begin(5, HELLO_HASH); append(id, 0, HELLO); Object held = finish(id);
        Field input = held.getClass().getDeclaredField("input"); input.setAccessible(true);
        input.set(held, new ByteArrayInputStream(HELLO) {
            @Override public void close() throws IOException { throw new IOException("Synthetic close failure"); }
        });
        try { closeCompleted(held); fail("Input close failure must be visible"); }
        catch (UncheckedIOException expected) { }
        finally { input.set(held, null); }
        empty(); closeCompleted(held);
    }
    @Test public void refusesSymlinkOwnedDirectoryWithoutTouchingDestination() throws Exception {
        invoke(stage, "close", new Class<?>[0]); stage = null; Path dir = root.toPath().resolve("letscube-media-export");
        try (java.util.stream.Stream<Path> files = Files.list(dir)) { for (Path p : (Iterable<Path>) files::iterator) Files.delete(p); }
        Files.delete(dir); Path elsewhere = temporary.newFolder("elsewhere").toPath(), marker = elsewhere.resolve("keep.txt"); Files.write(marker, HELLO);
        try { Files.createSymbolicLink(dir, elsewhere); } catch (IOException | UnsupportedOperationException e) { System.out.println("SYMLINK_CASE_UNAVAILABLE"); Assume.assumeNoException("Symlink privilege unavailable", e); }
        refused(() -> create(root)); assertArrayEquals(HELLO, Files.readAllBytes(marker)); Files.delete(dir);
    }
}
