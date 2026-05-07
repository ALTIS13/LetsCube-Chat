export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type AppRole = 'admin' | 'manager' | 'user'
export type ChatMemberRole = 'owner' | 'admin' | 'member'
export type FolderScope = 'personal' | 'shared' | 'system'
export type TaskStatus =
  | 'new'
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'waiting_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TaskVisibility = 'staff' | 'private' | 'chat'
export type TaskAssignmentScope = 'user' | 'manager_pool' | 'staff_pool'
export type TaskEventKind =
  | 'create'
  | 'assign'
  | 'accept'
  | 'start'
  | 'send_for_confirmation'
  | 'confirm'
  | 'reject'
  | 'cancel'
  | 'comment'
  | 'update'
  | 'return_to_work'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string | null
          full_name: string | null
          avatar_url: string | null
          bio: string | null
          online_at: string | null
          role: AppRole
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          online_at?: string | null
          role?: AppRole
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          online_at?: string | null
          role?: AppRole
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      // Phone numbers live HERE, NOT on `profiles`, so RLS can hide
      // them from non-staff readers. SELECT is granted only to the
      // owner OR `is_manager_or_admin(auth.uid())`. UPDATE is owner-
      // only — staff cannot change another user's phone. See
      // `.migration-backup/supabase/migrations/20260504_phone_privacy.sql`.
      // In-app notifications (Task #32). Inserts are server-only via
      // `_notify` triggers; clients only SELECT (own rows) and call
      // the `notifications_mark_read*` RPCs to flip `read_at`. RLS
      // blocks every non-SECURITY-DEFINER write.
      notifications: {
        Row: {
          id: string
          user_id: string
          kind: string
          payload: Json
          read_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      // Audit log (Task #33). Inserts are server-only via SECURITY
      // DEFINER trigger functions; clients only SELECT (admins only —
      // managers do NOT read this table). UPDATE/DELETE have no
      // policies and are revoked from anon/authenticated, so even an
      // admin cannot tamper with rows via PostgREST.
      audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          action: string
          target_kind: string
          target_id: string | null
          diff: Json
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      profile_contacts: {
        Row: {
          user_id: string
          phone: string | null
          phone_verified: boolean
          updated_at: string
        }
        Insert: {
          user_id: string
          phone?: string | null
          phone_verified?: boolean
          updated_at?: string
        }
        Update: {
          phone?: string | null
          // phone_verified is intentionally absent: the DB trigger
          // clamps any direct client write to its previous value.
          // Use the `profile_phone_mark_verified` RPC to flip it.
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      chats: {
        Row: {
          id: string
          type: 'private' | 'group' | 'channel'
          name: string | null
          description: string | null
          avatar_url: string | null
          created_by: string | null
          is_forum: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: 'private' | 'group' | 'channel'
          name?: string | null
          description?: string | null
          avatar_url?: string | null
          created_by?: string | null
          is_forum?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          type?: 'private' | 'group' | 'channel'
          name?: string | null
          description?: string | null
          avatar_url?: string | null
          created_by?: string | null
          is_forum?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      topics: {
        Row: {
          id: string
          chat_id: string
          name: string
          emoji: string | null
          is_general: boolean
          position: number
          archived: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          chat_id: string
          name: string
          emoji?: string | null
          is_general?: boolean
          position?: number
          archived?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          emoji?: string | null
          position?: number
          archived?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_members: {
        Row: {
          chat_id: string
          user_id: string
          role: ChatMemberRole
          joined_at: string
          last_read_at: string | null
          last_delivered_at: string | null
          hidden_at: string | null
          cleared_at: string | null
          pinned: boolean
          pinned_at: string | null
        }
        Insert: {
          chat_id: string
          user_id: string
          role?: ChatMemberRole
          joined_at?: string
          last_read_at?: string | null
          last_delivered_at?: string | null
          hidden_at?: string | null
          cleared_at?: string | null
          pinned?: boolean
          pinned_at?: string | null
        }
        Update: {
          role?: ChatMemberRole
          last_read_at?: string | null
          last_delivered_at?: string | null
          hidden_at?: string | null
          cleared_at?: string | null
          pinned?: boolean
          pinned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      messages: {
        Row: {
          id: string
          chat_id: string
          topic_id: string | null
          user_id: string | null
          content: string | null
          type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'system'
          media_url: string | null
          reply_to_id: string | null
          forwarded_from_id: string | null
          edited_at: string | null
          deleted_at: string | null
          pinned: boolean
          created_at: string
        }
        Insert: {
          id?: string
          chat_id: string
          topic_id?: string | null
          user_id?: string | null
          content?: string | null
          type?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'system'
          media_url?: string | null
          reply_to_id?: string | null
          forwarded_from_id?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          pinned?: boolean
          created_at?: string
        }
        Update: {
          content?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          pinned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          }
        ]
      }
      message_hidden_for_users: {
        Row: {
          message_id: string
          user_id: string
          hidden_at: string
        }
        Insert: {
          message_id: string
          user_id?: string
          hidden_at?: string
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: "message_hidden_for_users_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_hidden_for_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      reactions: {
        Row: {
          id: string
          message_id: string
          user_id: string
          emoji: string
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          user_id: string
          emoji: string
          created_at?: string
        }
        Update: {
          emoji?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      folders: {
        Row: {
          id: string
          user_id: string
          created_by: string | null
          scope: FolderScope
          name: string
          emoji: string | null
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          created_by?: string | null
          scope?: FolderScope
          name: string
          emoji?: string | null
          position?: number
          created_at?: string
        }
        Update: {
          name?: string
          emoji?: string | null
          position?: number
          scope?: FolderScope
          created_by?: string | null
        }
        Relationships: []
      }
      folder_chats: {
        Row: {
          folder_id: string
          chat_id: string
        }
        Insert: {
          folder_id: string
          chat_id: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      bans: {
        Row: {
          id: string
          user_id: string
          reason: string
          expires_at: string | null
          issued_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          reason: string
          expires_at?: string | null
          issued_by?: string | null
          created_at?: string
        }
        Update: {
          reason?: string
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      mutes: {
        Row: {
          id: string
          user_id: string
          chat_id: string | null
          reason: string
          expires_at: string | null
          issued_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          chat_id?: string | null
          reason: string
          expires_at?: string | null
          issued_by?: string | null
          created_at?: string
        }
        Update: {
          reason?: string
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutes_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          title: string
          description: string | null
          priority: TaskPriority
          status: TaskStatus
          created_by: string | null
          assignee_id: string | null
          chat_id: string | null
          due_at: string | null
          created_at: string
          updated_at: string
          visibility: TaskVisibility
          assignment_scope: TaskAssignmentScope
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          }
        ]
      }
      task_events: {
        Row: {
          id: string
          task_id: string
          actor_id: string | null
          kind: TaskEventKind
          payload: Json
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      // Manually maintained until `supabase gen types typescript` is wired
      // into the project. Mirrors the SECURITY DEFINER RPC declared in
      // `.migration-backup/supabase/migrations/20260504_roles_admin.sql`.
      admin_user_emails: {
        Args: { uids: string[] }
        Returns: { id: string; email: string }[]
      }
      // Atomically returns the existing private chat between caller and
      // target, or creates a new one. SECURITY DEFINER — see
      // `.migration-backup/supabase/migrations/20260504_chats_membership_hardening.sql`.
      open_or_create_private_chat: {
        Args: { target_user_id: string }
        Returns: string
      }
      // Computer Club Task System RPCs (Task #30) — see
      // `.migration-backup/supabase/migrations/20260504_tasks_system.sql`.
      // All transitions live behind SECURITY DEFINER functions: the `tasks`
      // table itself rejects every direct INSERT/UPDATE/DELETE.
      task_create: {
        Args: {
          p_title: string
          p_description?: string | null
          p_assignee_id?: string | null
          p_priority?: TaskPriority
          p_due_at?: string | null
          p_chat_id?: string | null
        }
        Returns: string
      }
      task_create_v2: {
        Args: {
          p_title: string
          p_description?: string | null
          p_assignee_id?: string | null
          p_priority?: TaskPriority
          p_due_at?: string | null
          p_chat_id?: string | null
          p_visibility?: TaskVisibility
          p_assignment_scope?: TaskAssignmentScope
        }
        Returns: string
      }
      task_assign: {
        Args: { p_task_id: string; p_assignee_id: string }
        Returns: void
      }
      task_claim: {
        Args: { p_task_id: string }
        Returns: void
      }
      task_accept: { Args: { p_task_id: string }; Returns: void }
      task_start:  { Args: { p_task_id: string }; Returns: void }
      task_send_for_confirmation: {
        Args: { p_task_id: string; p_note?: string | null }
        Returns: void
      }
      task_confirm: {
        Args: { p_task_id: string; p_note?: string | null }
        Returns: void
      }
      task_reject: {
        Args: { p_task_id: string; p_reason: string }
        Returns: void
      }
      task_cancel: {
        Args: { p_task_id: string; p_reason: string }
        Returns: void
      }
      task_comment: {
        Args: { p_task_id: string; p_text: string }
        Returns: void
      }
      // Assignee re-opens a rejected task. Source: rejected → in_progress.
      // Emits a `return_to_work` event with optional `payload.note`.
      task_return_to_work: {
        Args: { p_task_id: string; p_note?: string | null }
        Returns: void
      }
      // Creator/staff edit a non-finalised task (status not in
      // confirmed/cancelled). Full-replace semantics: passing null for
      // description/due_at/assignee_id/chat_id clears the field. See
      // `.migration-backup/supabase/migrations/20260504_tasks_update_and_chat_lockdown.sql`.
      task_update: {
        Args: {
          p_task_id: string
          p_title: string
          p_description: string | null
          p_priority: TaskPriority
          p_due_at: string | null
          p_assignee_id: string | null
          p_chat_id: string | null
        }
        Returns: void
      }
      task_update_v2: {
        Args: {
          p_task_id: string
          p_title: string
          p_description: string | null
          p_priority: TaskPriority
          p_due_at: string | null
          p_assignee_id: string | null
          p_chat_id: string | null
          p_visibility: TaskVisibility
          p_assignment_scope: TaskAssignmentScope
        }
        Returns: void
      }
      // Mirrors `auth.users.phone_confirmed_at` into
      // `profile_contacts.phone_verified` for the calling user. Server
      // re-checks auth.users so the client cannot fake verification.
      // See `.migration-backup/supabase/migrations/20260504_phone_privacy.sql`.
      profile_phone_mark_verified: {
        Args: Record<string, never>
        Returns: void
      }
      // Mark a single in-app notification (Task #32) read for the
      // calling user. Other users' rows are silently ignored. Both
      // RPCs are SECURITY DEFINER so the client cannot bypass them
      // and write other columns.
      notifications_mark_read: {
        Args: { p_id: string }
        Returns: void
      }
      notifications_mark_all_read: {
        Args: Record<string, never>
        Returns: void
      }
      pin_message: {
        Args: { p_message_id: string }
        Returns: Message
      }
      unpin_message: {
        Args: { p_message_id: string }
        Returns: Message
      }
      clear_chat_for_me: {
        Args: { p_chat_id: string }
        Returns: void
      }
      hide_private_chat: {
        Args: { p_chat_id: string }
        Returns: void
      }
      unhide_private_chat: {
        Args: { p_chat_id: string }
        Returns: void
      }
      hide_message_for_me: {
        Args: { p_message_id: string }
        Returns: void
      }
      mark_chat_delivered: {
        Args: { p_chat_id: string }
        Returns: void
      }
      mark_chat_read: {
        Args: { p_chat_id: string }
        Returns: void
      }
      unhide_message_for_me: {
        Args: { p_message_id: string }
        Returns: void
      }
      pin_chat: {
        Args: { p_chat_id: string }
        Returns: void
      }
      unpin_chat: {
        Args: { p_chat_id: string }
        Returns: void
      }
    }
    Enums: {
      app_role: AppRole
      chat_member_role: ChatMemberRole
      folder_scope: FolderScope
      task_status: TaskStatus
      task_priority: TaskPriority
      task_visibility: TaskVisibility
      task_assignment_scope: TaskAssignmentScope
    }
    CompositeTypes: Record<string, never>
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Chat = Database['public']['Tables']['chats']['Row']
export type ChatMember = Database['public']['Tables']['chat_members']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type MessageHiddenForUser = Database['public']['Tables']['message_hidden_for_users']['Row']
export type Reaction = Database['public']['Tables']['reactions']['Row']
export type Folder = Database['public']['Tables']['folders']['Row']
export type FolderChat = Database['public']['Tables']['folder_chats']['Row']
export type Topic = Database['public']['Tables']['topics']['Row']
export type Ban = Database['public']['Tables']['bans']['Row']
export type Mute = Database['public']['Tables']['mutes']['Row']
export type Task = Database['public']['Tables']['tasks']['Row']
export type TaskEvent = Database['public']['Tables']['task_events']['Row']
export type ProfileContact = Database['public']['Tables']['profile_contacts']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type NotificationKind =
  | 'task_assigned'
  | 'task_waiting_confirmation'
  | 'task_confirmed'
  | 'task_rejected'
  | 'chat_added'
  | 'mute_issued'
  | 'ban_issued'
export type AuditLog = Database['public']['Tables']['audit_logs']['Row']
export type AuditAction =
  | 'role_change'
  | 'ban_issued'
  | 'ban_lifted'
  | 'mute_issued'
  | 'mute_lifted'
  | 'chat_member_added'
  | 'chat_member_role_changed'
  | 'chat_member_removed'
  | 'folder_deleted'
  | 'task_status_change'
  | 'message_deleted_by_staff'

export interface AuditLogWithActor extends AuditLog {
  actor?: Profile | null
}

export interface TaskWithPeople extends Task {
  assignee?: Profile | null
  creator?: Profile | null
  chat?: Chat | null
}

export interface TaskEventWithActor extends TaskEvent {
  actor?: Profile | null
}

export interface ChatWithLastMessage extends Chat {
  last_message?: Message & { sender?: Profile }
  unread_count?: number
  members?: (ChatMember & { profile: Profile })[]
  other_user?: Profile  // for private chats
  is_muted?: boolean
  is_pinned?: boolean
  pinned_at?: string | null
  hidden_at?: string | null
  cleared_at?: string | null
}

export interface MessageWithSender extends Message {
  sender?: Profile
  reactions?: (Reaction & { user?: Profile })[]
  reply_to?: MessageWithSender
  /** Optimistic UI: true while the INSERT is in flight. Cleared once the server returns. */
  pending?: boolean
  /** Optimistic UI: true if the INSERT failed; lets MessageBubble show a retry/error icon. */
  failed?: boolean
}
