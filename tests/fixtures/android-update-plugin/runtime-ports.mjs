// Persist and JSON leaves for the complete production Runtime finalization path.
export const runtimePorts = {
  'android/util/AtomicFile.java': `package android.util;
public class AtomicFile {
  public static boolean refuseWrite;
  private final java.io.File file;
  public AtomicFile(java.io.File file) { this.file = file; }
  public java.io.FileInputStream openRead() throws java.io.FileNotFoundException { return new java.io.FileInputStream(file); }
  public java.io.FileOutputStream startWrite() throws java.io.IOException {
    if (!Thread.currentThread().getName().equals("runtime-owned-worker")) throw new AssertionError("INSTALL_FINALIZATION_NOT_ON_RUNTIME_WORKER");
    if (refuseWrite) throw new java.io.IOException("CONTROLLED_PERSIST_REFUSAL");
    return new java.io.FileOutputStream(file);
  }
  public void finishWrite(java.io.FileOutputStream out) throws java.io.IOException { out.getFD().sync(); out.close(); }
  public void failWrite(java.io.FileOutputStream out) throws java.io.IOException { out.close(); }
  public void delete() { file.delete(); }
}`,
  'org/json/JSONObject.java': `package org.json;
public class JSONObject extends java.util.LinkedHashMap<String,Object> {
  public static final Object NULL = new Object();
  public JSONObject() {}
  public JSONObject(String unused) { throw new AssertionError("UNEXPECTED_CATALOG_OR_RESTORE_PARSE"); }
  public JSONObject put(String key, Object value) { super.put(key, value); return this; }
  public String getString(String key) { return (String)get(key); }
  public JSONObject getJSONObject(String key) { return (JSONObject)get(key); }
  public String toString() {
    java.util.List<String> fields = new java.util.ArrayList<>();
    for (java.util.Map.Entry<String,Object> entry : entrySet()) {
      Object value = entry.getValue();
      fields.add("\\\"" + entry.getKey() + "\\\":" + (value instanceof String ? "\\\"" + value + "\\\"" : value == NULL ? "null" : String.valueOf(value)));
    }
    return "{" + String.join(",", fields) + "}";
  }
}`,
};
