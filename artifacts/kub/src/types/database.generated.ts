export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json
          id: string
          target_id: string | null
          target_kind: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json
          id?: string
          target_id?: string | null
          target_kind: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json
          id?: string
          target_id?: string | null
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bans: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          issued_by: string | null
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bans_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          chat_id: string
          cleared_at: string | null
          hidden_at: string | null
          joined_at: string
          last_delivered_at: string | null
          last_read_at: string | null
          pinned: boolean
          pinned_at: string | null
          pinned_order: number | null
          role: Database["public"]["Enums"]["chat_member_role"]
          user_id: string
        }
        Insert: {
          chat_id: string
          cleared_at?: string | null
          hidden_at?: string | null
          joined_at?: string
          last_delivered_at?: string | null
          last_read_at?: string | null
          pinned?: boolean
          pinned_at?: string | null
          pinned_order?: number | null
          role?: Database["public"]["Enums"]["chat_member_role"]
          user_id: string
        }
        Update: {
          chat_id?: string
          cleared_at?: string | null
          hidden_at?: string | null
          joined_at?: string
          last_delivered_at?: string | null
          last_read_at?: string | null
          pinned?: boolean
          pinned_at?: string | null
          pinned_order?: number | null
          role?: Database["public"]["Enums"]["chat_member_role"]
          user_id?: string
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
          },
        ]
      }
      chats: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          invite_policy: string
          is_forum: boolean
          name: string | null
          type: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          invite_policy?: string
          is_forum?: boolean
          name?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          invite_policy?: string
          is_forum?: boolean
          name?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      folder_chats: {
        Row: {
          chat_id: string
          folder_id: string
        }
        Insert: {
          chat_id: string
          folder_id: string
        }
        Update: {
          chat_id?: string
          folder_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folder_chats_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folder_chats_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          created_at: string
          created_by: string | null
          emoji: string | null
          id: string
          name: string
          position: number | null
          scope: Database["public"]["Enums"]["folder_scope"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          name: string
          position?: number | null
          scope?: Database["public"]["Enums"]["folder_scope"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          name?: string
          position?: number | null
          scope?: Database["public"]["Enums"]["folder_scope"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invites: {
        Row: {
          chat_id: string
          created_at: string
          expires_at: string | null
          id: string
          invitee_id: string
          inviter_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          invitee_id: string
          inviter_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          invitee_id?: string
          inviter_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      location_members: {
        Row: {
          created_at: string
          is_primary: boolean
          location_id: string
          primary_admin_id: string | null
          role: string
          role_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_primary?: boolean
          location_id: string
          primary_admin_id?: string | null
          role: string
          role_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_primary?: boolean
          location_id?: string
          primary_admin_id?: string | null
          role?: string
          role_id?: string | null
          updated_at?: string
          user_id?: string
        }
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
            foreignKeyName: "location_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_hidden_for_users: {
        Row: {
          hidden_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          hidden_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          hidden_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_hidden_for_users_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          chat_id: string
          client_message_id: string | null
          client_sent_at: string | null
          content: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_from_id: string | null
          id: string
          media_bucket: string | null
          media_path: string | null
          media_url: string | null
          pinned: boolean | null
          reply_to_id: string | null
          topic_id: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          chat_id: string
          client_message_id?: string | null
          client_sent_at?: string | null
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_from_id?: string | null
          id?: string
          media_bucket?: string | null
          media_path?: string | null
          media_url?: string | null
          pinned?: boolean | null
          reply_to_id?: string | null
          topic_id?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          chat_id?: string
          client_message_id?: string | null
          client_sent_at?: string | null
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_from_id?: string | null
          id?: string
          media_bucket?: string | null
          media_path?: string | null
          media_url?: string | null
          pinned?: boolean | null
          reply_to_id?: string | null
          topic_id?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_from_id_fkey"
            columns: ["forwarded_from_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mutes: {
        Row: {
          chat_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          issued_by: string | null
          reason: string
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          reason: string
          user_id: string
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mutes_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutes_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications_push_outbox: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          notification_id: string
          payload: Json
          sent_at: string | null
          subscription_id: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          notification_id: string
          payload: Json
          sent_at?: string | null
          subscription_id: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          notification_id?: string
          payload?: Json
          sent_at?: string | null
          subscription_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_push_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_push_outbox_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string | null
          description: string | null
          key: string
          name: string
        }
        Insert: {
          category?: string | null
          description?: string | null
          key: string
          name: string
        }
        Update: {
          category?: string | null
          description?: string | null
          key?: string
          name?: string
        }
        Relationships: []
      }
      profile_contacts: {
        Row: {
          phone: string | null
          phone_verified: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          phone?: string | null
          phone_verified?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          phone?: string | null
          phone_verified?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          full_name: string | null
          id: string
          online_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          online_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          online_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
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
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_key: string
          role_id: string
        }
        Insert: {
          permission_key: string
          role_id: string
        }
        Update: {
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      task_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          task_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrence_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          recurrence_id: string
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          recurrence_id: string
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          recurrence_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrence_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrence_events_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrence_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrences: {
        Row: {
          by_monthday: number | null
          by_weekday: number[] | null
          created_at: string
          created_by: string | null
          end_at: string | null
          frequency: string
          id: string
          interval_count: number
          last_run_at: string | null
          max_occurrences: number | null
          next_run_at: string | null
          occurrences_created: number
          paused_at: string | null
          starts_at: string
          stopped_at: string | null
          template_task_id: string
          updated_at: string
        }
        Insert: {
          by_monthday?: number | null
          by_weekday?: number[] | null
          created_at?: string
          created_by?: string | null
          end_at?: string | null
          frequency: string
          id?: string
          interval_count?: number
          last_run_at?: string | null
          max_occurrences?: number | null
          next_run_at?: string | null
          occurrences_created?: number
          paused_at?: string | null
          starts_at: string
          stopped_at?: string | null
          template_task_id: string
          updated_at?: string
        }
        Update: {
          by_monthday?: number | null
          by_weekday?: number[] | null
          created_at?: string
          created_by?: string | null
          end_at?: string | null
          frequency?: string
          id?: string
          interval_count?: number
          last_run_at?: string | null
          max_occurrences?: number | null
          next_run_at?: string | null
          occurrences_created?: number
          paused_at?: string | null
          starts_at?: string
          stopped_at?: string | null
          template_task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_template_task_id_fkey"
            columns: ["template_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          chat_id: string | null
          created_at: string
          created_by: string | null
          created_for_admin: boolean
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_at: string | null
          id: string
          location_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence_id: string | null
          recurrence_scheduled_for: string | null
          recurrence_template_task_id: string | null
          route_admin_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          target_role: string | null
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["task_visibility"]
        }
        Insert: {
          assignee_id?: string | null
          assignment_scope?: Database["public"]["Enums"]["task_assignment_scope"]
          chat_id?: string | null
          created_at?: string
          created_by?: string | null
          created_for_admin?: boolean
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          location_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_id?: string | null
          recurrence_scheduled_for?: string | null
          recurrence_template_task_id?: string | null
          route_admin_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          target_role?: string | null
          title: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["task_visibility"]
        }
        Update: {
          assignee_id?: string | null
          assignment_scope?: Database["public"]["Enums"]["task_assignment_scope"]
          chat_id?: string | null
          created_at?: string
          created_by?: string | null
          created_for_admin?: boolean
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          location_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_id?: string | null
          recurrence_scheduled_for?: string | null
          recurrence_template_task_id?: string | null
          route_admin_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          target_role?: string | null
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["task_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
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
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "tasks_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_template_task_id_fkey"
            columns: ["recurrence_template_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_route_admin_id_fkey"
            columns: ["route_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          archived: boolean
          chat_id: string
          created_at: string
          created_by: string | null
          emoji: string | null
          id: string
          is_general: boolean
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          chat_id: string
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          is_general?: boolean
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          chat_id?: string
          created_at?: string
          created_by?: string | null
          emoji?: string | null
          id?: string
          is_general?: boolean
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_global_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_global_roles_assigned_by_fkey"
            columns: ["assigned_by"]
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
            foreignKeyName: "user_global_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _audit: {
        Args: {
          p_action: string
          p_diff: Json
          p_target_id: string
          p_target_kind: string
        }
        Returns: undefined
      }
      _critical_role_count: { Args: { p_role_key: string }; Returns: number }
      _group_invite_payload: {
        Args: { p_invite: Database["public"]["Tables"]["group_invites"]["Row"] }
        Returns: Json
      }
      _kub_can_access_chat_media_path: {
        Args: { p_name: string }
        Returns: boolean
      }
      _kub_chat_media_chat_id: { Args: { p_name: string }; Returns: string }
      _kub_media_path_allowed: { Args: { p_name: string }; Returns: boolean }
      _legacy_role_has_permission: {
        Args: {
          p_permission_key: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      _location_assert_admin_member: {
        Args: { p_admin_id: string; p_location_id: string }
        Returns: undefined
      }
      _normalize_phone_e164: { Args: { p: string }; Returns: string }
      _notification_push_payload: {
        Args: { p_kind: string; p_payload: Json }
        Returns: Json
      }
      _notify: {
        Args: { p_kind: string; p_payload?: Json; p_user_id: string }
        Returns: undefined
      }
      _require_permission: {
        Args: { p_permission_key: string }
        Returns: undefined
      }
      _task_assert_can_assign_to: {
        Args: { p_target: string }
        Returns: undefined
      }
      _task_assert_location_routing: {
        Args: {
          p_assignee_id: string
          p_assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          p_created_for_admin: boolean
          p_location_id: string
          p_route_admin_id: string
          p_target_role: string
        }
        Returns: undefined
      }
      _task_assert_visibility_assignment: {
        Args: {
          p_assignee_id: string
          p_assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: undefined
      }
      _task_can_restore: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] }
        Returns: boolean
      }
      _task_can_soft_delete: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] }
        Returns: boolean
      }
      _task_deleted_visible_to_current_user: { Args: never; Returns: boolean }
      _task_recurrence_can_manage: {
        Args: { p_task: Database["public"]["Tables"]["tasks"]["Row"] }
        Returns: boolean
      }
      _task_recurrence_initial_next_run: {
        Args: {
          p_by_monthday: number
          p_by_weekday: number[]
          p_frequency: string
          p_interval_count: number
          p_starts_at: string
        }
        Returns: string
      }
      _task_recurrence_next_run_after: {
        Args: {
          p_after: string
          p_by_monthday: number
          p_by_weekday: number[]
          p_frequency: string
          p_interval_count: number
          p_starts_at: string
        }
        Returns: string
      }
      _task_recurrence_validate: {
        Args: {
          p_by_monthday: number
          p_by_weekday: number[]
          p_end_at: string
          p_frequency: string
          p_interval_count: number
          p_max_occurrences: number
          p_starts_at: string
        }
        Returns: undefined
      }
      _task_recurrence_visible_to_current_user: {
        Args: { p_recurrence_id: string }
        Returns: boolean
      }
      _task_transition: {
        Args: {
          p_assignee_only: boolean
          p_from_statuses: Database["public"]["Enums"]["task_status"][]
          p_kind: string
          p_payload?: Json
          p_task_id: string
          p_to_status: Database["public"]["Enums"]["task_status"]
        }
        Returns: undefined
      }
      _task_visible_to_current_user: {
        Args: {
          p_assignee_id: string
          p_assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id: string
          p_created_by: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: boolean
      }
      _task_visible_to_current_user_v3: {
        Args: {
          p_assignee_id: string
          p_assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id: string
          p_created_by: string
          p_created_for_admin: boolean
          p_location_id: string
          p_route_admin_id: string
          p_target_role: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: boolean
      }
      admin_update_user_profile: {
        Args: { p_avatar_url: string; p_user_id: string }
        Returns: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          full_name: string | null
          id: string
          online_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_user_emails: {
        Args: { uids: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      can_see_shared_folder: { Args: { fid: string }; Returns: boolean }
      chat_role_of: {
        Args: { cid: string }
        Returns: Database["public"]["Enums"]["chat_member_role"]
      }
      clear_chat_for_me: { Args: { p_chat_id: string }; Returns: undefined }
      get_my_chat_ids: { Args: never; Returns: string[] }
      group_invite_accept: { Args: { p_invite_id: string }; Returns: string }
      group_invite_cancel: {
        Args: { p_invite_id: string }
        Returns: {
          chat_id: string
          created_at: string
          expires_at: string | null
          id: string
          invitee_id: string
          inviter_id: string
          responded_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "group_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      group_invite_create: {
        Args: { p_chat_id: string; p_invitee_id: string }
        Returns: {
          chat_id: string
          created_at: string
          expires_at: string | null
          id: string
          invitee_id: string
          inviter_id: string
          responded_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "group_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      group_invite_decline: {
        Args: { p_invite_id: string }
        Returns: {
          chat_id: string
          created_at: string
          expires_at: string | null
          id: string
          invitee_id: string
          inviter_id: string
          responded_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "group_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_global_role: {
        Args: { p_role_key: string; p_user_id: string }
        Returns: boolean
      }
      has_location_permission: {
        Args: {
          p_location_id: string
          p_permission_key: string
          p_user_id: string
        }
        Returns: boolean
      }
      has_location_role: {
        Args: { p_location_id: string; p_role_key: string; p_user_id: string }
        Returns: boolean
      }
      has_permission: {
        Args: { p_permission_key: string; p_user_id: string }
        Returns: boolean
      }
      hide_message_for_me: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      hide_private_chat: { Args: { p_chat_id: string }; Returns: undefined }
      is_admin: { Args: { uid?: string }; Returns: boolean }
      is_banned: { Args: { uid?: string }; Returns: boolean }
      is_chat_admin: { Args: { cid: string }; Returns: boolean }
      is_chat_member: { Args: { cid: string }; Returns: boolean }
      is_chat_owner: { Args: { cid: string }; Returns: boolean }
      is_location_admin: {
        Args: { p_location_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_manager_or_admin: { Args: { uid?: string }; Returns: boolean }
      is_muted: { Args: { cid?: string; uid: string }; Returns: boolean }
      location_archive: { Args: { p_location_id: string }; Returns: undefined }
      location_create: {
        Args: { p_address?: string; p_description?: string; p_name: string }
        Returns: string
      }
      location_member_assign: {
        Args: {
          p_location_id: string
          p_primary_admin_id?: string
          p_role: string
          p_user_id: string
        }
        Returns: undefined
      }
      location_member_assign_role: {
        Args: {
          p_location_id: string
          p_primary_admin_id?: string
          p_role_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      location_member_remove: {
        Args: { p_location_id: string; p_user_id: string }
        Returns: undefined
      }
      location_member_set_primary_admin: {
        Args: { p_admin_id: string; p_location_id: string; p_user_id: string }
        Returns: undefined
      }
      location_role_of: {
        Args: { p_location_id: string; p_user_id?: string }
        Returns: string
      }
      location_update: {
        Args: {
          p_address?: string
          p_description?: string
          p_is_active?: boolean
          p_location_id: string
          p_name: string
        }
        Returns: undefined
      }
      mark_chat_delivered: { Args: { p_chat_id: string }; Returns: undefined }
      mark_chat_read: { Args: { p_chat_id: string }; Returns: undefined }
      notifications_mark_all_read: { Args: never; Returns: undefined }
      notifications_mark_read: { Args: { p_id: string }; Returns: undefined }
      open_or_create_private_chat: {
        Args: { target_user_id: string }
        Returns: string
      }
      pin_chat: { Args: { p_chat_id: string }; Returns: undefined }
      pin_message: {
        Args: { p_message_id: string }
        Returns: {
          chat_id: string
          client_message_id: string | null
          client_sent_at: string | null
          content: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_from_id: string | null
          id: string
          media_bucket: string | null
          media_path: string | null
          media_url: string | null
          pinned: boolean | null
          reply_to_id: string | null
          topic_id: string | null
          type: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profile_phone_mark_verified: { Args: never; Returns: undefined }
      role_create: {
        Args: {
          p_description?: string
          p_key: string
          p_name: string
          p_scope?: string
        }
        Returns: string
      }
      role_delete_or_archive: {
        Args: { p_role_id: string }
        Returns: undefined
      }
      role_set_permissions: {
        Args: { p_permission_keys: string[]; p_role_id: string }
        Returns: undefined
      }
      role_update: {
        Args: {
          p_description?: string
          p_is_active?: boolean
          p_name: string
          p_role_id: string
        }
        Returns: undefined
      }
      set_pinned_chat_order: {
        Args: { p_chat_ids: string[] }
        Returns: undefined
      }
      task_accept: { Args: { p_task_id: string }; Returns: undefined }
      task_append_event: {
        Args: { p_kind: string; p_payload?: Json; p_task_id: string }
        Returns: undefined
      }
      task_assign: {
        Args: { p_assignee_id: string; p_task_id: string }
        Returns: undefined
      }
      task_bulk_soft_delete: {
        Args: { p_reason?: string; p_task_ids: string[] }
        Returns: Json
      }
      task_cancel: {
        Args: { p_reason: string; p_task_id: string }
        Returns: undefined
      }
      task_claim: { Args: { p_task_id: string }; Returns: undefined }
      task_comment: {
        Args: { p_task_id: string; p_text: string }
        Returns: undefined
      }
      task_confirm: {
        Args: { p_note?: string; p_task_id: string }
        Returns: undefined
      }
      task_create: {
        Args: {
          p_assignee_id?: string
          p_chat_id?: string
          p_description?: string
          p_due_at?: string
          p_priority?: Database["public"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: string
      }
      task_create_v2: {
        Args: {
          p_assignee_id?: string
          p_assignment_scope?: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id?: string
          p_description?: string
          p_due_at?: string
          p_priority?: Database["public"]["Enums"]["task_priority"]
          p_title: string
          p_visibility?: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: string
      }
      task_create_v3: {
        Args: {
          p_assignee_id?: string
          p_assignment_scope?: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id?: string
          p_created_for_admin?: boolean
          p_description?: string
          p_due_at?: string
          p_location_id?: string
          p_priority?: Database["public"]["Enums"]["task_priority"]
          p_route_admin_id?: string
          p_target_role?: string
          p_title: string
          p_visibility?: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: string
      }
      task_recurrence_create: {
        Args: {
          p_by_monthday?: number
          p_by_weekday?: number[]
          p_end_at?: string
          p_frequency: string
          p_interval_count: number
          p_max_occurrences?: number
          p_starts_at?: string
          p_template_task_id: string
        }
        Returns: string
      }
      task_recurrence_pause: {
        Args: { p_recurrence_id: string }
        Returns: undefined
      }
      task_recurrence_resume: {
        Args: { p_recurrence_id: string }
        Returns: undefined
      }
      task_recurrence_run_due: { Args: { p_limit?: number }; Returns: number }
      task_recurrence_stop: {
        Args: { p_recurrence_id: string }
        Returns: undefined
      }
      task_recurrence_update: {
        Args: {
          p_by_monthday?: number
          p_by_weekday?: number[]
          p_end_at?: string
          p_frequency: string
          p_interval_count: number
          p_max_occurrences?: number
          p_next_run_at?: string
          p_recurrence_id: string
        }
        Returns: undefined
      }
      task_reject: {
        Args: { p_reason: string; p_task_id: string }
        Returns: undefined
      }
      task_restore: { Args: { p_task_id: string }; Returns: undefined }
      task_return_to_work: {
        Args: { p_note?: string; p_task_id: string }
        Returns: undefined
      }
      task_send_for_confirmation: {
        Args: { p_note?: string; p_task_id: string }
        Returns: undefined
      }
      task_soft_delete: {
        Args: { p_reason?: string; p_task_id: string }
        Returns: undefined
      }
      task_start: { Args: { p_task_id: string }; Returns: undefined }
      task_update: {
        Args: {
          p_assignee_id: string
          p_chat_id: string
          p_description: string
          p_due_at: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_task_id: string
          p_title: string
        }
        Returns: undefined
      }
      task_update_v2: {
        Args: {
          p_assignee_id: string
          p_assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id: string
          p_description: string
          p_due_at: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_task_id: string
          p_title: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: undefined
      }
      task_update_v3: {
        Args: {
          p_assignee_id: string
          p_assignment_scope: Database["public"]["Enums"]["task_assignment_scope"]
          p_chat_id: string
          p_created_for_admin?: boolean
          p_description: string
          p_due_at: string
          p_location_id?: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_route_admin_id?: string
          p_target_role?: string
          p_task_id: string
          p_title: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
        }
        Returns: undefined
      }
      unhide_message_for_me: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      unhide_private_chat: { Args: { p_chat_id: string }; Returns: undefined }
      unpin_chat: { Args: { p_chat_id: string }; Returns: undefined }
      unpin_message: {
        Args: { p_message_id: string }
        Returns: {
          chat_id: string
          client_message_id: string | null
          client_sent_at: string | null
          content: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_from_id: string | null
          id: string
          media_bucket: string | null
          media_path: string | null
          media_url: string | null
          pinned: boolean | null
          reply_to_id: string | null
          topic_id: string | null
          type: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_assign_global_role: {
        Args: { p_role_id: string; p_user_id: string }
        Returns: undefined
      }
      user_remove_global_role: {
        Args: { p_role_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "user"
      chat_member_role: "owner" | "admin" | "member"
      folder_scope: "personal" | "shared" | "system"
      task_assignment_scope: "user" | "manager_pool" | "staff_pool"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status:
        | "new"
        | "assigned"
        | "accepted"
        | "in_progress"
        | "waiting_confirmation"
        | "confirmed"
        | "rejected"
        | "cancelled"
      task_visibility: "staff" | "private" | "chat"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "user"],
      chat_member_role: ["owner", "admin", "member"],
      folder_scope: ["personal", "shared", "system"],
      task_assignment_scope: ["user", "manager_pool", "staff_pool"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: [
        "new",
        "assigned",
        "accepted",
        "in_progress",
        "waiting_confirmation",
        "confirmed",
        "rejected",
        "cancelled",
      ],
      task_visibility: ["staff", "private", "chat"],
    },
  },
} as const
