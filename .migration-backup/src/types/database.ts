export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
          phone: string | null
          online_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          phone?: string | null
          online_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          phone?: string | null
          online_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
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
          role: 'owner' | 'admin' | 'member'
          joined_at: string
          last_read_at: string | null
        }
        Insert: {
          chat_id: string
          user_id: string
          role?: 'owner' | 'admin' | 'member'
          joined_at?: string
          last_read_at?: string | null
        }
        Update: {
          role?: 'owner' | 'admin' | 'member'
          last_read_at?: string | null
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
          name: string
          emoji: string | null
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          emoji?: string | null
          position?: number
          created_at?: string
        }
        Update: {
          name?: string
          emoji?: string | null
          position?: number
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Chat = Database['public']['Tables']['chats']['Row']
export type ChatMember = Database['public']['Tables']['chat_members']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type Reaction = Database['public']['Tables']['reactions']['Row']
export type Folder = Database['public']['Tables']['folders']['Row']
export type FolderChat = Database['public']['Tables']['folder_chats']['Row']
export type Topic = Database['public']['Tables']['topics']['Row']

export interface ChatWithLastMessage extends Chat {
  last_message?: Message & { sender?: Profile }
  unread_count?: number
  members?: (ChatMember & { profile: Profile })[]
  other_user?: Profile  // for private chats
  is_muted?: boolean
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
