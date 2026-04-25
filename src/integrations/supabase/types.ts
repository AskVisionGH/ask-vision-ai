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
      alert_rules: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          kind: Database["public"]["Enums"]["alert_rule_kind"]
          label: string
          last_triggered_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          kind: Database["public"]["Enums"]["alert_rule_kind"]
          label: string
          last_triggered_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["alert_rule_kind"]
          label?: string
          last_triggered_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_counters: {
        Row: {
          key: string
          updated_at: string
          value: number
        }
        Insert: {
          key: string
          updated_at?: string
          value?: number
        }
        Update: {
          key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
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
          share_mode: Database["public"]["Enums"]["share_mode"]
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
          share_mode?: Database["public"]["Enums"]["share_mode"]
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
          share_mode?: Database["public"]["Enums"]["share_mode"]
          title?: string
          updated_at?: string
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      helius_webhooks: {
        Row: {
          address_count: number
          auth_header: string
          created_at: string
          id: string
          last_synced_at: string
          updated_at: string
          webhook_id: string
        }
        Insert: {
          address_count?: number
          auth_header: string
          created_at?: string
          id?: string
          last_synced_at?: string
          updated_at?: string
          webhook_id: string
        }
        Update: {
          address_count?: number
          auth_header?: string
          created_at?: string
          id?: string
          last_synced_at?: string
          updated_at?: string
          webhook_id?: string
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
      notification_preferences: {
        Row: {
          cat_news_sentiment: boolean
          cat_order_fills: boolean
          cat_price: boolean
          cat_wallet_activity: boolean
          channel_in_app: boolean
          channel_web_push: boolean
          created_at: string
          master_enabled: boolean
          post_order_prompt_seen: boolean
          quiet_end: string | null
          quiet_hours_enabled: boolean
          quiet_start: string | null
          quiet_timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cat_news_sentiment?: boolean
          cat_order_fills?: boolean
          cat_price?: boolean
          cat_wallet_activity?: boolean
          channel_in_app?: boolean
          channel_web_push?: boolean
          created_at?: string
          master_enabled?: boolean
          post_order_prompt_seen?: boolean
          quiet_end?: string | null
          quiet_hours_enabled?: boolean
          quiet_start?: string | null
          quiet_timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cat_news_sentiment?: boolean
          cat_order_fills?: boolean
          cat_price?: boolean
          cat_wallet_activity?: boolean
          channel_in_app?: boolean
          channel_web_push?: boolean
          created_at?: string
          master_enabled?: boolean
          post_order_prompt_seen?: boolean
          quiet_end?: string | null
          quiet_hours_enabled?: boolean
          quiet_start?: string | null
          quiet_timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          category: Database["public"]["Enums"]["notification_category"]
          created_at: string
          id: string
          link: string | null
          metadata: Json | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          id?: string
          link?: string | null
          metadata?: Json | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          id?: string
          link?: string | null
          metadata?: Json | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          experience: Database["public"]["Enums"]["crypto_experience"] | null
          id: string
          interests: string[]
          language: string
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
          language?: string
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
          language?: string
          onboarding_completed?: boolean
          risk_tolerance?: Database["public"]["Enums"]["risk_tolerance"] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
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
      smart_money_sync_state: {
        Row: {
          consecutive_failures: number
          last_error: string | null
          last_signature: string | null
          last_synced_at: string
          trades_last_sync: number
          updated_at: string
          wallet_address: string
        }
        Insert: {
          consecutive_failures?: number
          last_error?: string | null
          last_signature?: string | null
          last_synced_at?: string
          trades_last_sync?: number
          updated_at?: string
          wallet_address: string
        }
        Update: {
          consecutive_failures?: number
          last_error?: string | null
          last_signature?: string | null
          last_synced_at?: string
          trades_last_sync?: number
          updated_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
      smart_money_trades: {
        Row: {
          block_time: string
          created_at: string
          id: string
          side: string
          signature: string
          source: string | null
          token_amount: number
          token_mint: string
          value_usd: number | null
          wallet_address: string
          wallet_category: string | null
          wallet_is_curated: boolean
          wallet_label: string
          wallet_notes: string | null
          wallet_twitter_handle: string | null
        }
        Insert: {
          block_time: string
          created_at?: string
          id?: string
          side: string
          signature: string
          source?: string | null
          token_amount: number
          token_mint: string
          value_usd?: number | null
          wallet_address: string
          wallet_category?: string | null
          wallet_is_curated?: boolean
          wallet_label: string
          wallet_notes?: string | null
          wallet_twitter_handle?: string | null
        }
        Update: {
          block_time?: string
          created_at?: string
          id?: string
          side?: string
          signature?: string
          source?: string | null
          token_amount?: number
          token_mint?: string
          value_usd?: number | null
          wallet_address?: string
          wallet_category?: string | null
          wallet_is_curated?: boolean
          wallet_label?: string
          wallet_notes?: string | null
          wallet_twitter_handle?: string | null
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
      treasury_fees: {
        Row: {
          amount: number
          amount_usd: number | null
          asset_address: string | null
          asset_symbol: string | null
          block_time: string
          chain: string
          created_at: string
          from_address: string | null
          id: string
          metadata: Json | null
          related_tx_event_id: string | null
          related_user_id: string | null
          signature: string
          source_kind: string
          treasury_address: string
        }
        Insert: {
          amount?: number
          amount_usd?: number | null
          asset_address?: string | null
          asset_symbol?: string | null
          block_time: string
          chain: string
          created_at?: string
          from_address?: string | null
          id?: string
          metadata?: Json | null
          related_tx_event_id?: string | null
          related_user_id?: string | null
          signature: string
          source_kind: string
          treasury_address: string
        }
        Update: {
          amount?: number
          amount_usd?: number | null
          asset_address?: string | null
          asset_symbol?: string | null
          block_time?: string
          chain?: string
          created_at?: string
          from_address?: string | null
          id?: string
          metadata?: Json | null
          related_tx_event_id?: string | null
          related_user_id?: string | null
          signature?: string
          source_kind?: string
          treasury_address?: string
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
      bump_counter: { Args: { _key: string }; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      alert_rule_kind: "price" | "wallet_activity" | "portfolio_pnl"
      app_role: "admin" | "user" | "super_admin"
      crypto_experience: "new" | "intermediate" | "advanced"
      notification_category:
        | "price"
        | "wallet_activity"
        | "order_fills"
        | "news_sentiment"
      risk_tolerance: "cautious" | "balanced" | "aggressive"
      share_mode: "read_only" | "importable"
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
      alert_rule_kind: ["price", "wallet_activity", "portfolio_pnl"],
      app_role: ["admin", "user", "super_admin"],
      crypto_experience: ["new", "intermediate", "advanced"],
      notification_category: [
        "price",
        "wallet_activity",
        "order_fills",
        "news_sentiment",
      ],
      risk_tolerance: ["cautious", "balanced", "aggressive"],
      share_mode: ["read_only", "importable"],
      tx_event_kind: ["swap", "transfer", "bridge"],
    },
  },
} as const
