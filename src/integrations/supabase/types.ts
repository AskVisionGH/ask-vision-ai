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
      contacts: {
        Row: {
          address: string
          created_at: string
          id: string
          name: string
          resolved_address: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          name: string
          resolved_address?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          name?: string
          resolved_address?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          pin_order: number
          pinned: boolean
          share_id: string | null
          title: string
          updated_at: string
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          pin_order?: number
          pinned?: boolean
          share_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          pin_order?: number
          pinned?: boolean
          share_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_events: Json | null
          user_id: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_events?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_events?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          experience: Database["public"]["Enums"]["crypto_experience"] | null
          id: string
          interests: string[]
          onboarding_completed: boolean
          risk_tolerance: Database["public"]["Enums"]["risk_tolerance"] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          experience?: Database["public"]["Enums"]["crypto_experience"] | null
          id?: string
          interests?: string[]
          onboarding_completed?: boolean
          risk_tolerance?: Database["public"]["Enums"]["risk_tolerance"] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          experience?: Database["public"]["Enums"]["crypto_experience"] | null
          id?: string
          interests?: string[]
          onboarding_completed?: boolean
          risk_tolerance?: Database["public"]["Enums"]["risk_tolerance"] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      siws_nonces: {
        Row: {
          consumed: boolean
          created_at: string
          expires_at: string
          id: string
          nonce: string
          wallet_address: string
        }
        Insert: {
          consumed?: boolean
          created_at?: string
          expires_at: string
          id?: string
          nonce: string
          wallet_address: string
        }
        Update: {
          consumed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string
          wallet_address?: string
        }
        Relationships: []
      }
      smart_wallets: {
        Row: {
          address: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          notes: string | null
          twitter_handle: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          is_default?: boolean
          label: string
          notes?: string | null
          twitter_handle?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          notes?: string | null
          twitter_handle?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      smart_wallets_global_seed: {
        Row: {
          address: string
          category: string | null
          created_at: string
          id: string
          label: string
          notes: string | null
          twitter_handle: string | null
        }
        Insert: {
          address: string
          category?: string | null
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          twitter_handle?: string | null
        }
        Update: {
          address?: string
          category?: string | null
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          twitter_handle?: string | null
        }
        Relationships: []
      }
      sweep_runs: {
        Row: {
          accounts_claimed: number
          accounts_scanned: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          per_token: Json | null
          signatures: string[]
          started_at: string
          status: string
          total_value_usd: number | null
          trigger: string
        }
        Insert: {
          accounts_claimed?: number
          accounts_scanned?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          per_token?: Json | null
          signatures?: string[]
          started_at?: string
          status: string
          total_value_usd?: number | null
          trigger: string
        }
        Update: {
          accounts_claimed?: number
          accounts_scanned?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          per_token?: Json | null
          signatures?: string[]
          started_at?: string
          status?: string
          total_value_usd?: number | null
          trigger?: string
        }
        Relationships: []
      }
      tx_events: {
        Row: {
          created_at: string
          id: string
          input_amount: number | null
          input_mint: string | null
          kind: Database["public"]["Enums"]["tx_event_kind"]
          metadata: Json | null
          output_amount: number | null
          output_mint: string | null
          recipient: string | null
          signature: string
          user_id: string
          value_usd: number | null
          wallet_address: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          input_amount?: number | null
          input_mint?: string | null
          kind: Database["public"]["Enums"]["tx_event_kind"]
          metadata?: Json | null
          output_amount?: number | null
          output_mint?: string | null
          recipient?: string | null
          signature: string
          user_id: string
          value_usd?: number | null
          wallet_address?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          input_amount?: number | null
          input_mint?: string | null
          kind?: Database["public"]["Enums"]["tx_event_kind"]
          metadata?: Json | null
          output_amount?: number | null
          output_mint?: string | null
          recipient?: string | null
          signature?: string
          user_id?: string
          value_usd?: number | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_links: {
        Row: {
          created_at: string
          id: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_get_user_emails: {
        Args: { _user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      crypto_experience: "new" | "intermediate" | "advanced"
      risk_tolerance: "cautious" | "balanced" | "aggressive"
      tx_event_kind: "swap" | "transfer" | "bridge"
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
      app_role: ["admin", "user"],
      crypto_experience: ["new", "intermediate", "advanced"],
      risk_tolerance: ["cautious", "balanced", "aggressive"],
      tx_event_kind: ["swap", "transfer", "bridge"],
    },
  },
} as const
