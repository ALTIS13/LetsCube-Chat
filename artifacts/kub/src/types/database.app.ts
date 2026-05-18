import type { Database as ManualDatabase } from "./database";
import type { Database as GeneratedDatabaseSchema } from "./database.generated";

export type AppDatabase = ManualDatabase;
export type GeneratedDatabase = GeneratedDatabaseSchema;

export type AppTableName = keyof AppDatabase["public"]["Tables"];
export type GeneratedTableName = keyof GeneratedDatabase["public"]["Tables"];

export type AppTableRow<TTable extends AppTableName> =
  AppDatabase["public"]["Tables"][TTable]["Row"];
export type GeneratedTableRow<TTable extends GeneratedTableName> =
  GeneratedDatabase["public"]["Tables"][TTable]["Row"];

export type AppRpcName = keyof AppDatabase["public"]["Functions"];
export type GeneratedRpcName = keyof GeneratedDatabase["public"]["Functions"];

export type AppRpcArgs<TRpc extends AppRpcName> =
  AppDatabase["public"]["Functions"][TRpc]["Args"];
export type AppRpcReturns<TRpc extends AppRpcName> =
  AppDatabase["public"]["Functions"][TRpc]["Returns"];

export type GeneratedRpcArgs<TRpc extends GeneratedRpcName> =
  GeneratedDatabase["public"]["Functions"][TRpc]["Args"];
export type GeneratedRpcReturns<TRpc extends GeneratedRpcName> =
  GeneratedDatabase["public"]["Functions"][TRpc]["Returns"];

export type GeneratedMessageRow = GeneratedTableRow<"messages">;
export type GeneratedTaskRow = GeneratedTableRow<"tasks">;
export type GeneratedLocationRow = GeneratedTableRow<"locations">;
export type GeneratedTaskRecurrenceRow = GeneratedTableRow<"task_recurrences">;

export type GeneratedGlobalSearchV2Row = GeneratedRpcReturns<"global_search_v2">[number];
export type GeneratedSearchChatMessagesRow =
  GeneratedRpcReturns<"search_chat_messages">[number];
