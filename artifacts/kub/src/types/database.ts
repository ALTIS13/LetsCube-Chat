export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type AppRole = 'admin' | 'manager' | 'user'
export type ChatMemberRole = 'owner' | 'admin' | 'member'
export type LocationRole = 'owner' | 'admin' | 'manager' | 'staff'
export type RoleScope = 'global' | 'location' | 'chat'
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
export type TaskTargetRole = 'staff' | 'admin' | 'manager' | 'owner'
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
      locations: {
        Row: {
          id: string
          name: string
          description: string | null
          address: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      location_members: {
        Row: {
          location_id: string
          user_id: string
          role: LocationRole
          role_id: string | null
          primary_admin_id: string | null
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "location_members_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_members_primary_admin_id_fkey"
            columns: ["primary_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      roles: {
        Row: {
          id: string
          key: string
          name: string
          description: string | null
          scope: RoleScope
          is_system: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      permissions: {
        Row: {
          key: string
          name: string
          description: string | null
          category: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      role_permissions: {
        Row: {
          role_id: string
          permission_key: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          }
        ]
      }
      user_global_roles: {
        Row: {
          user_id: string
          role_id: string
          assigned_by: string | null
          assigned_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "user_global_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_global_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_global_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
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
          invite_policy: 'owner_admin_only' | 'members_can_invite'
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
          invite_policy?: 'owner_admin_only' | 'members_can_invite'
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
          invite_policy?: 'owner_admin_only' | 'members_can_invite'
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
          pinned_order: number | null
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
          pinned_order?: number | null
        }
        Update: {
          role?: ChatMemberRole
          last_read_at?: string | null
          last_delivered_at?: string | null
          hidden_at?: string | null
          cleared_at?: string | null
          pinned?: boolean
          pinned_at?: string | null
          pinned_order?: number | null
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
      group_invites: {
        Row: {
          id: string
          chat_id: string
          inviter_id: string
          invitee_id: string
          status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
          created_at: string
          expires_at: string | null
          responded_at: string | null
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "group_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_invitee_id_fkey"
            columns: ["invitee_id"]
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
          client_message_id: string | null
          client_sent_at: string | null
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
          client_message_id?: string | null
          client_sent_at?: string | null
        }
        Update: {
          content?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          pinned?: boolean
          client_message_id?: string | null
          client_sent_at?: string | null
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
          location_id: string | null
          target_role: TaskTargetRole | null
          route_admin_id: string | null
          created_for_admin: boolean
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
          },
          {
            foreignKeyName: "tasks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_route_admin_id_fkey"
            columns: ["route_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      admin_update_user_profile: {
        Args: { p_user_id: string; p_avatar_url: string | null }
        Returns: Database['public']['Tables']['profiles']['Row']
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
      task_create_v3: {
        Args: {
          p_title: string
          p_description?: string | null
          p_assignee_id?: string | null
          p_priority?: TaskPriority
          p_due_at?: string | null
          p_chat_id?: string | null
          p_visibility?: TaskVisibility
          p_assignment_scope?: TaskAssignmentScope
          p_location_id?: string | null
          p_target_role?: TaskTargetRole | null
          p_route_admin_id?: string | null
          p_created_for_admin?: boolean
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
      task_update_v3: {
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
          p_location_id?: string | null
          p_target_role?: TaskTargetRole | null
          p_route_admin_id?: string | null
          p_created_for_admin?: boolean
        }
        Returns: void
      }
      location_create: {
        Args: { p_name: string; p_description?: string | null; p_address?: string | null }
        Returns: string
      }
      location_update: {
        Args: {
          p_location_id: string
          p_name: string
          p_description?: string | null
          p_address?: string | null
          p_is_active?: boolean
        }
        Returns: void
      }
      location_archive: {
        Args: { p_location_id: string }
        Returns: void
      }
      location_member_assign: {
        Args: {
          p_location_id: string
          p_user_id: string
          p_role: LocationRole
          p_primary_admin_id?: string | null
        }
        Returns: void
      }
      location_member_remove: {
        Args: { p_location_id: string; p_user_id: string }
        Returns: void
      }
      location_member_set_primary_admin: {
        Args: { p_location_id: string; p_user_id: string; p_admin_id: string }
        Returns: void
      }
      has_global_role: {
        Args: { p_user_id: string; p_role_key: string }
        Returns: boolean
      }
      has_permission: {
        Args: { p_user_id: string; p_permission_key: string }
        Returns: boolean
      }
      has_location_role: {
        Args: { p_user_id: string; p_location_id: string; p_role_key: string }
        Returns: boolean
      }
      has_location_permission: {
        Args: { p_user_id: string; p_location_id: string; p_permission_key: string }
        Returns: boolean
      }
      role_create: {
        Args: {
          p_key: string
          p_name: string
          p_description?: string | null
          p_scope: RoleScope
        }
        Returns: string
      }
      role_update: {
        Args: {
          p_role_id: string
          p_name: string
          p_description?: string | null
          p_is_active?: boolean
        }
        Returns: void
      }
      role_set_permissions: {
        Args: { p_role_id: string; p_permission_keys: string[] }
        Returns: void
      }
      role_delete_or_archive: {
        Args: { p_role_id: string }
        Returns: void
      }
      user_assign_global_role: {
        Args: { p_user_id: string; p_role_id: string }
        Returns: void
      }
      user_remove_global_role: {
        Args: { p_user_id: string; p_role_id: string }
        Returns: void
      }
      location_member_assign_role: {
        Args: {
          p_location_id: string
          p_user_id: string
          p_role_id: string
          p_primary_admin_id?: string | null
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
      group_invite_create: {
        Args: { p_chat_id: string; p_invitee_id: string }
        Returns: Database['public']['Tables']['group_invites']['Row']
      }
      group_invite_accept: {
        Args: { p_invite_id: string }
        Returns: string
      }
      group_invite_decline: {
        Args: { p_invite_id: string }
        Returns: Database['public']['Tables']['group_invites']['Row']
      }
      group_invite_cancel: {
        Args: { p_invite_id: string }
        Returns: Database['public']['Tables']['group_invites']['Row']
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
      set_pinned_chat_order: {
        Args: { p_chat_ids: string[] }
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
export type Location = Database['public']['Tables']['locations']['Row']
export type LocationMember = Database['public']['Tables']['location_members']['Row']
export type DynamicRole = Database['public']['Tables']['roles']['Row']
export type Permission = Database['public']['Tables']['permissions']['Row']
export type RolePermission = Database['public']['Tables']['role_permissions']['Row']
export type UserGlobalRole = Database['public']['Tables']['user_global_roles']['Row']
export type Chat = Database['public']['Tables']['chats']['Row']
export type ChatMember = Database['public']['Tables']['chat_members']['Row']
export type GroupInvite = Database['public']['Tables']['group_invites']['Row']
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
  | 'group_invite'
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
  location?: Location | null
  route_admin?: Profile | null
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
  pinned_order?: number | null
  hidden_at?: string | null
  cleared_at?: string | null
}

export interface MessageWithSender extends Message {
  sender?: Profile
  reactions?: (Reaction & { user?: Profile })[]
  reply_to?: MessageWithSender
  /** Optimistic UI: true while the INSERT is in flight. Cleared once the server returns. */
  pending?: boolean
  /** Local UI: true while we are checking whether an unknown insert reached the DB. */
  checking?: boolean
  /** Optimistic UI: true if the INSERT failed; lets MessageBubble show a retry/error icon. */
  failed?: boolean
  /** Local UI: friendly failed-send reason. Not persisted. */
  send_error?: string | null
}
