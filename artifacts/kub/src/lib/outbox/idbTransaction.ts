/** A request succeeding is not a durable ACK: its transaction can still abort. */
export function idbTransaction<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const failed = () => reject(new Error("IDB_TRANSACTION_FAILED"));
    let tx: IDBTransaction;
    try { tx = db.transaction(storeName, mode); }
    catch { failed(); return; }
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = failed;
    try {
      const request = run(tx.objectStore(storeName));
      request.onsuccess = () => { value = request.result; };
      request.onerror = failed;
    } catch {
      try { tx.abort(); } catch { /* It may already be inactive. */ }
      failed();
    }
  });
}
