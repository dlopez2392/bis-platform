export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app: {
    Tables: {
      record_changes_settings: {
        Row: {
          enforce: boolean
          id: boolean
        }
        Insert: {
          enforce?: boolean
          id?: boolean
        }
        Update: {
          enforce?: boolean
          id?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_role: { Args: { p_account_id: string }; Returns: string }
      agency_visit_window: { Args: never; Returns: string }
      backfill_contact_authors: {
        Args: never
        Returns: {
          bucket: string
          row_count: number
        }[]
      }
      backfill_record_change_authors: {
        Args: never
        Returns: {
          bucket: string
          row_count: number
        }[]
      }
      backfill_record_provenance: {
        Args: never
        Returns: {
          bucket: string
          row_count: number
        }[]
      }
      booking_author: {
        Args: { p_actor_type: string; p_has_ip: boolean }
        Returns: string
      }
      company_name_for: { Args: { p_contact_id: string }; Returns: string }
      contact_author: {
        Args: { p_actor_id: string; p_actor_type: string }
        Returns: string
      }
      contact_match_ids: {
        Args: {
          p_account_id: string
          p_national?: string
          p_phone_keys?: string[]
          p_text: string
          p_tokens?: string[]
        }
        Returns: string[]
      }
      contact_name_fold: { Args: { p: string }; Returns: string }
      contact_name_key: {
        Args: { p_first: string; p_last: string }
        Returns: string
      }
      contact_search_name: {
        Args: { p_company: string; p_first: string; p_last: string }
        Returns: string
      }
      current_account_id: { Args: never; Returns: string }
      current_user_id: { Args: never; Returns: string }
      document_request_items_ok: { Args: { p_items: Json }; Returns: boolean }
      find_or_create_business: {
        Args: { p_account_id: string; p_name: string }
        Returns: Record<string, unknown>
      }
      group_name_key: { Args: { p_name: string }; Returns: string }
      group_ws: { Args: never; Returns: string }
      is_account_owner: { Args: { p_account_id: string }; Returns: boolean }
      is_agency: { Args: never; Returns: boolean }
      is_technician: { Args: { p_account_id: string }; Returns: boolean }
      jwt: { Args: never; Returns: Json }
      link_member: {
        Args: {
          p_account_id: string
          p_contact_id: string
          p_group_id: string
          p_primary: boolean
          p_role: string
        }
        Returns: string
      }
      lock_contact: {
        Args: { p_account_id: string; p_contact_id: string }
        Returns: boolean
      }
      may_merge: { Args: { p_account_id: string }; Returns: boolean }
      merge_fields_of: {
        Args: { p_row: Database["public"]["Tables"]["contacts"]["Row"] }
        Returns: Json
      }
      merge_push: {
        Args: { p_key: string; p_obj: Json; p_value: Json }
        Returns: Json
      }
      merge_side: {
        Args: { p_choice: string; p_keep: string; p_other: string }
        Returns: string
      }
      merge_target: { Args: { p_id: string }; Returns: string }
      message_author: {
        Args: { p_actor_type: string; p_direction: string }
        Returns: string
      }
      my_client_group_ids: { Args: never; Returns: string[] }
      my_contact_ids: { Args: never; Returns: string[] }
      my_place_ids: { Args: never; Returns: string[] }
      open_duplicate_pairs: {
        Args: {
          p_account_id: string
          p_after_created_at?: string
          p_after_id?: string
          p_after_strength?: number
          p_contact_id?: string
          p_limit?: number
        }
        Returns: {
          a_first_name: string
          a_last_name: string
          b_first_name: string
          b_last_name: string
          contact_a: string
          contact_b: string
          created_at: string
          id: string
          reason: string
          strength: number
        }[]
      }
      owner_line_day_start: {
        Args: { p_at: string; p_zone: string }
        Returns: string
      }
      phone_family: { Args: { p_phone: string }; Returns: string }
      phone_national: { Args: { p_phone: string }; Returns: string }
      promote_primary: { Args: { p_contact_id: string }; Returns: undefined }
      record_change_fields: { Args: { p_type: string }; Returns: string[] }
      required_document_categories_ok: {
        Args: { p_categories: string[] }
        Returns: boolean
      }
      restore_member: {
        Args: { p_account_id: string; p_snapshot: Json }
        Returns: string
      }
      sees_all_customers: { Args: { p_account_id: string }; Returns: boolean }
      tidy_text: { Args: { p_max: number; p_value: string }; Returns: boolean }
      voice_business_hours_valid: { Args: { p_hours: Json }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_ai_settings: {
        Row: {
          account_id: string
          day_key: string | null
          enabled: boolean
          month_key: string | null
          month_spend_microusd: number
          monthly_budget_cents: number
          record_summaries_today: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id: string
          day_key?: string | null
          enabled?: boolean
          month_key?: string | null
          month_spend_microusd?: number
          monthly_budget_cents?: number
          record_summaries_today?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          day_key?: string | null
          enabled?: boolean
          month_key?: string | null
          month_spend_microusd?: number
          monthly_budget_cents?: number
          record_summaries_today?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_ai_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_billing: {
        Row: {
          account_id: string
          billing_paused_at: string | null
          billing_started_at: string
          complimentary: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          past_due_since: string | null
          pause_lifted_at: string | null
          plan_id: string
          stripe_checked_at: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          billing_paused_at?: string | null
          billing_started_at?: string
          complimentary?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          past_due_since?: string | null
          pause_lifted_at?: string | null
          plan_id: string
          stripe_checked_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          billing_paused_at?: string | null
          billing_started_at?: string
          complimentary?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          past_due_since?: string | null
          pause_lifted_at?: string | null
          plan_id?: string
          stripe_checked_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_billing_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_billing_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          a2p_brand_id: string | null
          a2p_campaign_id: string | null
          a2p_status: string
          a2p_updated_at: string | null
          agency_id: string
          alert_phone: string | null
          brand_color: string | null
          brand_corners: string | null
          brand_logo_path: string | null
          brand_mode: string | null
          brand_name: string | null
          brand_neutral: string | null
          brand_type: string | null
          clerk_org_id: string
          client_access_enabled: boolean
          created_at: string
          from_email: string | null
          id: string
          inbound_domain: string | null
          inbound_mode: string
          language: string | null
          mailing_address: string | null
          name: string
          outbound_suppressed: boolean
          owner_line_changed_at: string | null
          owner_line_changed_by_kind: string | null
          owner_line_enabled_at: string | null
          permissions: Json
          reply_to_email: string | null
          report_emails: string[]
          required_document_categories: string[]
          status: string
          telnyx_messaging_profile_id: string | null
          timezone: string
          trade: string | null
          trade_other: string | null
          transfer_phone: string | null
          weekly_report_week: string | null
        }
        Insert: {
          a2p_brand_id?: string | null
          a2p_campaign_id?: string | null
          a2p_status?: string
          a2p_updated_at?: string | null
          agency_id: string
          alert_phone?: string | null
          brand_color?: string | null
          brand_corners?: string | null
          brand_logo_path?: string | null
          brand_mode?: string | null
          brand_name?: string | null
          brand_neutral?: string | null
          brand_type?: string | null
          clerk_org_id: string
          client_access_enabled?: boolean
          created_at?: string
          from_email?: string | null
          id?: string
          inbound_domain?: string | null
          inbound_mode?: string
          language?: string | null
          mailing_address?: string | null
          name: string
          outbound_suppressed?: boolean
          owner_line_changed_at?: string | null
          owner_line_changed_by_kind?: string | null
          owner_line_enabled_at?: string | null
          permissions?: Json
          reply_to_email?: string | null
          report_emails?: string[]
          required_document_categories?: string[]
          status?: string
          telnyx_messaging_profile_id?: string | null
          timezone?: string
          trade?: string | null
          trade_other?: string | null
          transfer_phone?: string | null
          weekly_report_week?: string | null
        }
        Update: {
          a2p_brand_id?: string | null
          a2p_campaign_id?: string | null
          a2p_status?: string
          a2p_updated_at?: string | null
          agency_id?: string
          alert_phone?: string | null
          brand_color?: string | null
          brand_corners?: string | null
          brand_logo_path?: string | null
          brand_mode?: string | null
          brand_name?: string | null
          brand_neutral?: string | null
          brand_type?: string | null
          clerk_org_id?: string
          client_access_enabled?: boolean
          created_at?: string
          from_email?: string | null
          id?: string
          inbound_domain?: string | null
          inbound_mode?: string
          language?: string | null
          mailing_address?: string | null
          name?: string
          outbound_suppressed?: boolean
          owner_line_changed_at?: string | null
          owner_line_changed_by_kind?: string | null
          owner_line_enabled_at?: string | null
          permissions?: Json
          reply_to_email?: string | null
          report_emails?: string[]
          required_document_categories?: string[]
          status?: string
          telnyx_messaging_profile_id?: string | null
          timezone?: string
          trade?: string | null
          trade_other?: string | null
          transfer_phone?: string | null
          weekly_report_week?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          created_at: string
          id: string
          name: string
          report_email: string | null
          timezone: string
          weekly_report_week: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          report_email?: string | null
          timezone?: string
          weekly_report_week?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          report_email?: string | null
          timezone?: string
          weekly_report_week?: string | null
        }
        Relationships: []
      }
      agency_visit_items: {
        Row: {
          account_id: string
          first_opened_at: string
          id: string
          item_count: number | null
          kind: string
          record_id: string | null
          visit_id: string
        }
        Insert: {
          account_id: string
          first_opened_at?: string
          id?: string
          item_count?: number | null
          kind: string
          record_id?: string | null
          visit_id: string
        }
        Update: {
          account_id?: string
          first_opened_at?: string
          id?: string
          item_count?: number | null
          kind?: string
          record_id?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_visit_items_visit_fkey"
            columns: ["visit_id", "account_id"]
            isOneToOne: false
            referencedRelation: "agency_visits"
            referencedColumns: ["id", "account_id"]
          },
        ]
      }
      agency_visits: {
        Row: {
          account_id: string
          actor_clerk_user_id: string
          actor_kind: string
          actor_name: string | null
          clerk_session_id: string
          id: string
          reason: string
          started_at: string
        }
        Insert: {
          account_id: string
          actor_clerk_user_id: string
          actor_kind?: string
          actor_name?: string | null
          clerk_session_id: string
          id?: string
          reason: string
          started_at?: string
        }
        Update: {
          account_id?: string
          actor_clerk_user_id?: string
          actor_kind?: string
          actor_name?: string | null
          clerk_session_id?: string
          id?: string
          reason?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_visits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_acts: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          account_id: string
          actor: string
          after: Json | null
          before: Json | null
          call_id: string | null
          chat_id: string | null
          contact_id: string
          created_at: string
          id: string
          kind: string
          target: Json
          undo_notified: boolean
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          account_id: string
          actor: string
          after?: Json | null
          before?: Json | null
          call_id?: string | null
          chat_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          kind: string
          target: Json
          undo_notified?: boolean
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          account_id?: string
          actor?: string
          after?: Json | null
          before?: Json | null
          call_id?: string | null
          chat_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          kind?: string
          target?: Json
          undo_notified?: boolean
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_acts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_acts_call_fkey"
            columns: ["account_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "ai_acts_chat_fkey"
            columns: ["account_id", "chat_id"]
            isOneToOne: false
            referencedRelation: "concierge_conversations"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "ai_acts_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      ai_gateway_settings: {
        Row: {
          enabled: boolean
          id: boolean
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_ledger: {
        Row: {
          account_id: string
          cost_microusd: number
          created_at: string
          feature: string
          id: string
          input_tokens: number | null
          latency_ms: number
          model: string
          outcome: string
          output_tokens: number | null
        }
        Insert: {
          account_id: string
          cost_microusd?: number
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number
          model: string
          outcome: string
          output_tokens?: number | null
        }
        Update: {
          account_id?: string
          cost_microusd?: number
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number | null
          latency_ms?: number
          model?: string
          outcome?: string
          output_tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_phone_verifications: {
        Row: {
          account_id: string
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          phone: string
        }
        Insert: {
          account_id: string
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone: string
        }
        Update: {
          account_id?: string
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_phone_verifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_log: {
        Row: {
          account_id: string
          channel: string
          contact_id: string | null
          held_until: string | null
          id: string
          occurred_at: string
          payload: Json
          reason: string
          source: string
          status: string
          subject_key: string
        }
        Insert: {
          account_id: string
          channel: string
          contact_id?: string | null
          held_until?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          reason?: string
          source: string
          status: string
          subject_key: string
        }
        Update: {
          account_id?: string
          channel?: string
          contact_id?: string | null
          held_until?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          reason?: string
          source?: string
          status?: string
          subject_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_settings: {
        Row: {
          account_id: string
          created_at: string
          quiet_enabled: boolean
          quiet_end: string
          quiet_start: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          quiet_enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          quiet_enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          account_id: string
          body: string
          body_es: string | null
          body_es_basis: string | null
          config: Json
          created_at: string
          enabled: boolean
          id: string
          recipe_key: string
          updated_at: string
        }
        Insert: {
          account_id: string
          body?: string
          body_es?: string | null
          body_es_basis?: string | null
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          recipe_key: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          body?: string
          body_es?: string | null
          body_es_basis?: string | null
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          recipe_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_links: {
        Row: {
          account_id: string
          checkout_session_id: string
          checkout_url: string
          created_at: string
          expires_at: string
          plan_id: string
          sent_at: string
          sent_to: string
          stripe_customer_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          checkout_session_id: string
          checkout_url: string
          created_at?: string
          expires_at: string
          plan_id: string
          sent_at?: string
          sent_to: string
          stripe_customer_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          checkout_session_id?: string
          checkout_url?: string
          created_at?: string
          expires_at?: string
          plan_id?: string
          sent_at?: string
          sent_to?: string
          stripe_customer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_links_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_reconciliations: {
        Row: {
          account_id: string
          bis_held: number
          bis_in_flight: number
          bis_settled: number
          checked_at: string
          meter: string
          stripe_total: number
          verdict: string
          window_end: string
          window_start: string
        }
        Insert: {
          account_id: string
          bis_held: number
          bis_in_flight: number
          bis_settled: number
          checked_at?: string
          meter: string
          stripe_total: number
          verdict: string
          window_end: string
          window_start: string
        }
        Update: {
          account_id?: string
          bis_held?: number
          bis_in_flight?: number
          bis_settled?: number
          checked_at?: string
          meter?: string
          stripe_total?: number
          verdict?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprints: {
        Row: {
          agency_id: string
          assets: Json
          created_at: string
          id: string
          name: string
          source_account_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          agency_id: string
          assets?: Json
          created_at?: string
          id?: string
          name: string
          source_account_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          agency_id?: string
          assets?: Json
          created_at?: string
          id?: string
          name?: string
          source_account_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "blueprints_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blueprints_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_cancel_notices: {
        Row: {
          account_id: string
          booking_id: string
          created_at: string
          due_at: string
          email: Json
          message_id: string
          user_id: string
          version: string
        }
        Insert: {
          account_id: string
          booking_id: string
          created_at?: string
          due_at: string
          email: Json
          message_id: string
          user_id: string
          version: string
        }
        Update: {
          account_id?: string
          booking_id?: string
          created_at?: string
          due_at?: string
          email?: Json
          message_id?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_cancel_notices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_cancel_notices_booking_fkey"
            columns: ["account_id", "booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "booking_cancel_notices_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          account_id: string
          author_id: string | null
          author_kind: string
          booker_timezone: string | null
          calendar_id: string
          cancel_token: string
          closure_kept_at: string | null
          completed_at: string | null
          confirm_asked_at: string | null
          confirm_reply: string | null
          confirm_reply_at: string | null
          confirm_sms_failed_at: string | null
          contact_id: string
          created_at: string
          ends_at: string
          followup_sent_at: string | null
          hold_settled_at: string | null
          hold_until: string | null
          id: string
          ip_hash: string | null
          meeting_type: string | null
          meeting_url: string | null
          no_show_at: string | null
          no_show_nudge_sms_failed_at: string | null
          no_show_nudged_at: string | null
          note: string | null
          notice_sent_at: string | null
          notice_wanted: string | null
          place_id: string | null
          referral_ask_sms_failed_at: string | null
          referral_asked_at: string | null
          reminder_sent_at: string | null
          rescheduled_from_id: string | null
          review_request_sms_failed_at: string | null
          review_requested_at: string | null
          sms_reminder_failed_at: string | null
          sms_reminder_sent_at: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          author_id?: string | null
          author_kind: string
          booker_timezone?: string | null
          calendar_id: string
          cancel_token: string
          closure_kept_at?: string | null
          completed_at?: string | null
          confirm_asked_at?: string | null
          confirm_reply?: string | null
          confirm_reply_at?: string | null
          confirm_sms_failed_at?: string | null
          contact_id: string
          created_at?: string
          ends_at: string
          followup_sent_at?: string | null
          hold_settled_at?: string | null
          hold_until?: string | null
          id?: string
          ip_hash?: string | null
          meeting_type?: string | null
          meeting_url?: string | null
          no_show_at?: string | null
          no_show_nudge_sms_failed_at?: string | null
          no_show_nudged_at?: string | null
          note?: string | null
          notice_sent_at?: string | null
          notice_wanted?: string | null
          place_id?: string | null
          referral_ask_sms_failed_at?: string | null
          referral_asked_at?: string | null
          reminder_sent_at?: string | null
          rescheduled_from_id?: string | null
          review_request_sms_failed_at?: string | null
          review_requested_at?: string | null
          sms_reminder_failed_at?: string | null
          sms_reminder_sent_at?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          author_id?: string | null
          author_kind?: string
          booker_timezone?: string | null
          calendar_id?: string
          cancel_token?: string
          closure_kept_at?: string | null
          completed_at?: string | null
          confirm_asked_at?: string | null
          confirm_reply?: string | null
          confirm_reply_at?: string | null
          confirm_sms_failed_at?: string | null
          contact_id?: string
          created_at?: string
          ends_at?: string
          followup_sent_at?: string | null
          hold_settled_at?: string | null
          hold_until?: string | null
          id?: string
          ip_hash?: string | null
          meeting_type?: string | null
          meeting_url?: string | null
          no_show_at?: string | null
          no_show_nudge_sms_failed_at?: string | null
          no_show_nudged_at?: string | null
          note?: string | null
          notice_sent_at?: string | null
          notice_wanted?: string | null
          place_id?: string | null
          referral_ask_sms_failed_at?: string | null
          referral_asked_at?: string | null
          reminder_sent_at?: string | null
          rescheduled_from_id?: string | null
          review_request_sms_failed_at?: string | null
          review_requested_at?: string | null
          sms_reminder_failed_at?: string | null
          sms_reminder_sent_at?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_calendar_id_fkey"
            columns: ["account_id", "calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "bookings_contact_id_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "bookings_place_fkey"
            columns: ["account_id", "place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "bookings_rescheduled_from_fkey"
            columns: ["account_id", "rescheduled_from_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      business_status: {
        Row: {
          account_id: string
          late_minutes: number | null
          set_at: string
          set_by: string
          state: string
          until: string | null
        }
        Insert: {
          account_id: string
          late_minutes?: number | null
          set_at?: string
          set_by?: string
          state?: string
          until?: string | null
        }
        Update: {
          account_id?: string
          late_minutes?: number | null
          set_at?: string
          set_by?: string
          state?: string
          until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_status_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feeds: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          fetch_count: number
          fetch_window_started_at: string | null
          id: string
          last_fetched_at: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          fetch_count?: number
          fetch_window_started_at?: string | null
          id: string
          last_fetched_at?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          fetch_count?: number
          fetch_window_started_at?: string | null
          id?: string
          last_fetched_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_member_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["account_id", "user_id"]
          },
        ]
      }
      calendars: {
        Row: {
          account_id: string
          buffer_minutes: number
          created_at: string
          enabled: boolean
          followup_body: string
          followup_body_es: string | null
          followup_body_es_basis: string | null
          followup_enabled: boolean
          id: string
          max_advance_days: number
          meeting_type: string
          min_notice_hours: number
          notify_emails: string[]
          open_hours: Json
          public_id: string
          slot_duration_minutes: number
          updated_at: string
        }
        Insert: {
          account_id: string
          buffer_minutes?: number
          created_at?: string
          enabled?: boolean
          followup_body?: string
          followup_body_es?: string | null
          followup_body_es_basis?: string | null
          followup_enabled?: boolean
          id?: string
          max_advance_days?: number
          meeting_type?: string
          min_notice_hours?: number
          notify_emails?: string[]
          open_hours?: Json
          public_id: string
          slot_duration_minutes?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          buffer_minutes?: number
          created_at?: string
          enabled?: boolean
          followup_body?: string
          followup_body_es?: string | null
          followup_body_es_basis?: string | null
          followup_enabled?: boolean
          id?: string
          max_advance_days?: number
          meeting_type?: string
          min_notice_hours?: number
          notify_emails?: string[]
          open_hours?: Json
          public_id?: string
          slot_duration_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendars_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      call_usage: {
        Row: {
          account_id: string
          call_id: string
          created_at: string
          est_cost_microusd: number
          input_audio_tokens: number
          input_cached_audio_tokens: number
          input_cached_text_tokens: number
          input_text_tokens: number
          model: string
          output_audio_tokens: number
          output_text_tokens: number
          responses: number
          transcribe_input_tokens: number | null
          transcribe_model: string | null
          transcribe_output_tokens: number | null
          transcribe_seconds: number | null
        }
        Insert: {
          account_id: string
          call_id: string
          created_at?: string
          est_cost_microusd?: number
          input_audio_tokens?: number
          input_cached_audio_tokens?: number
          input_cached_text_tokens?: number
          input_text_tokens?: number
          model: string
          output_audio_tokens?: number
          output_text_tokens?: number
          responses?: number
          transcribe_input_tokens?: number | null
          transcribe_model?: string | null
          transcribe_output_tokens?: number | null
          transcribe_seconds?: number | null
        }
        Update: {
          account_id?: string
          call_id?: string
          created_at?: string
          est_cost_microusd?: number
          input_audio_tokens?: number
          input_cached_audio_tokens?: number
          input_cached_text_tokens?: number
          input_text_tokens?: number
          model?: string
          output_audio_tokens?: number
          output_text_tokens?: number
          responses?: number
          transcribe_input_tokens?: number | null
          transcribe_model?: string | null
          transcribe_output_tokens?: number | null
          transcribe_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "call_usage_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_usage_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          account_id: string
          booking_id: string | null
          business_status: string | null
          callback_number: string | null
          caller_e164: string | null
          caller_words: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          disclosed: boolean | null
          disclosure_setting: string | null
          duration_secs: number | null
          ended_at: string | null
          handoff_requested_at: string | null
          handoff_token: string | null
          id: string
          knowledge_version: number | null
          language: string
          outcome: string
          owner_line_user_id: string | null
          phone_number_id: string
          reason: string | null
          started_at: string
          summary: string
          trade_module: string | null
          trade_module_version: number | null
          transcript: Json
          transfer_answered_by: string | null
          transfer_failed_at: string | null
          transfer_failed_reason: string | null
          transfer_followup_at: string | null
          transfer_followup_by: string | null
          turn_count: number
        }
        Insert: {
          account_id: string
          booking_id?: string | null
          business_status?: string | null
          callback_number?: string | null
          caller_e164?: string | null
          caller_words?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          disclosed?: boolean | null
          disclosure_setting?: string | null
          duration_secs?: number | null
          ended_at?: string | null
          handoff_requested_at?: string | null
          handoff_token?: string | null
          id?: string
          knowledge_version?: number | null
          language?: string
          outcome?: string
          owner_line_user_id?: string | null
          phone_number_id: string
          reason?: string | null
          started_at?: string
          summary?: string
          trade_module?: string | null
          trade_module_version?: number | null
          transcript?: Json
          transfer_answered_by?: string | null
          transfer_failed_at?: string | null
          transfer_failed_reason?: string | null
          transfer_followup_at?: string | null
          transfer_followup_by?: string | null
          turn_count?: number
        }
        Update: {
          account_id?: string
          booking_id?: string | null
          business_status?: string | null
          callback_number?: string | null
          caller_e164?: string | null
          caller_words?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          disclosed?: boolean | null
          disclosure_setting?: string | null
          duration_secs?: number | null
          ended_at?: string | null
          handoff_requested_at?: string | null
          handoff_token?: string | null
          id?: string
          knowledge_version?: number | null
          language?: string
          outcome?: string
          owner_line_user_id?: string | null
          phone_number_id?: string
          reason?: string | null
          started_at?: string
          summary?: string
          trade_module?: string | null
          trade_module_version?: number | null
          transcript?: Json
          transfer_answered_by?: string | null
          transfer_failed_at?: string | null
          transfer_failed_reason?: string | null
          transfer_followup_at?: string | null
          transfer_followup_by?: string | null
          turn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "calls_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_knowledge_version_fkey"
            columns: ["account_id", "knowledge_version"]
            isOneToOne: false
            referencedRelation: "voice_knowledge_snapshots"
            referencedColumns: ["account_id", "version"]
          },
          {
            foreignKeyName: "calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          account_id: string
          created_at: string
          done_at: string | null
          done_by: string | null
          id: string
          item_key: string
          note: string | null
          position: number
          title: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_key: string
          note?: string | null
          position?: number
          title?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_key?: string
          note?: string | null
          position?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_group_members: {
        Row: {
          account_id: string
          client_group_id: string
          contact_id: string
          created_at: string
          id: string
          is_billing: boolean
          is_primary: boolean
          is_primary_contact: boolean
          role: string | null
        }
        Insert: {
          account_id: string
          client_group_id: string
          contact_id: string
          created_at?: string
          id?: string
          is_billing?: boolean
          is_primary?: boolean
          is_primary_contact?: boolean
          role?: string | null
        }
        Update: {
          account_id?: string
          client_group_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          is_billing?: boolean
          is_primary?: boolean
          is_primary_contact?: boolean
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_group_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_group_members_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "client_group_members_group_fkey"
            columns: ["account_id", "client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      client_groups: {
        Row: {
          account_id: string
          billing_address: string | null
          created_at: string
          custom: Json
          id: string
          kind: string
          name: string
          name_key: string | null
          search_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          billing_address?: string | null
          created_at?: string
          custom?: Json
          id?: string
          kind: string
          name: string
          name_key?: string | null
          search_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          billing_address?: string | null
          created_at?: string
          custom?: Json
          id?: string
          kind?: string
          name?: string
          name_key?: string | null
          search_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_groups_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      closed_days: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          ends_on: string
          id: string
          reason: string | null
          starts_on: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          ends_on: string
          id?: string
          reason?: string | null
          starts_on: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          ends_on?: string
          id?: string
          reason?: string | null
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "closed_days_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_conversations: {
        Row: {
          account_id: string
          attribution: Json
          created_at: string
          form_id: string
          id: string
          ip_hash: string
          knowledge_version: number | null
          last_turn_at: string
          locale: string
          origin: string | null
          submission_id: string | null
          trade_module: string | null
          trade_module_version: number | null
          transcript: Json
          turn_count: number
        }
        Insert: {
          account_id: string
          attribution?: Json
          created_at?: string
          form_id: string
          id?: string
          ip_hash: string
          knowledge_version?: number | null
          last_turn_at?: string
          locale?: string
          origin?: string | null
          submission_id?: string | null
          trade_module?: string | null
          trade_module_version?: number | null
          transcript?: Json
          turn_count?: number
        }
        Update: {
          account_id?: string
          attribution?: Json
          created_at?: string
          form_id?: string
          id?: string
          ip_hash?: string
          knowledge_version?: number | null
          last_turn_at?: string
          locale?: string
          origin?: string | null
          submission_id?: string | null
          trade_module?: string | null
          trade_module_version?: number | null
          transcript?: Json
          turn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "concierge_conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_conversations_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_conversations_knowledge_version_fkey"
            columns: ["account_id", "knowledge_version"]
            isOneToOne: false
            referencedRelation: "voice_knowledge_snapshots"
            referencedColumns: ["account_id", "version"]
          },
          {
            foreignKeyName: "concierge_conversations_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_events: {
        Row: {
          account_id: string
          action: string
          actor_id: string | null
          address: string
          channel: string
          contact_id: string | null
          created_at: string
          evidence: Json
          id: string
          method: string
          note: string | null
          occurred_at: string
          source_ref: string | null
        }
        Insert: {
          account_id: string
          action: string
          actor_id?: string | null
          address: string
          channel: string
          contact_id?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          method: string
          note?: string | null
          occurred_at?: string
          source_ref?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          actor_id?: string | null
          address?: string
          channel?: string
          contact_id?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          method?: string
          note?: string | null
          occurred_at?: string
          source_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      contact_archive_log: {
        Row: {
          account_id: string
          action: string
          author_id: string | null
          author_kind: string
          contact_id: string
          created_at: string
          id: number
          sign: string | null
        }
        Insert: {
          account_id: string
          action: string
          author_id?: string | null
          author_kind: string
          contact_id: string
          created_at?: string
          id?: never
          sign?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          author_id?: string | null
          author_kind?: string
          contact_id?: string
          created_at?: string
          id?: never
          sign?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_archive_log_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      contact_duplicate_flags: {
        Row: {
          account_id: string
          contact_a: string
          contact_b: string
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          id: string
          merge_id: number | null
          reason: string
          strength: number | null
        }
        Insert: {
          account_id: string
          contact_a: string
          contact_b: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          merge_id?: number | null
          reason: string
          strength?: number | null
        }
        Update: {
          account_id?: string
          contact_a?: string
          contact_b?: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          merge_id?: number | null
          reason?: string
          strength?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_duplicate_flags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_duplicate_flags_contact_a_fkey"
            columns: ["contact_a"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_duplicate_flags_contact_b_fkey"
            columns: ["contact_b"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_duplicate_flags_merge_id_fkey"
            columns: ["merge_id"]
            isOneToOne: false
            referencedRelation: "contact_merges"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merges: {
        Row: {
          account_id: string
          choices: Json
          id: number
          keep_after: Json
          keep_before: Json
          keep_id: string
          merged_at: string
          merged_by: string
          moved: Json
          moved_counts: Json
          other_id: string
          other_reply_token: string | null
          removed: Json
          undo_until: string
          undone_at: string | null
          undone_by: string | null
          unread_handed: number
        }
        Insert: {
          account_id: string
          choices: Json
          id?: never
          keep_after: Json
          keep_before: Json
          keep_id: string
          merged_at?: string
          merged_by: string
          moved: Json
          moved_counts: Json
          other_id: string
          other_reply_token?: string | null
          removed: Json
          undo_until: string
          undone_at?: string | null
          undone_by?: string | null
          unread_handed?: number
        }
        Update: {
          account_id?: string
          choices?: Json
          id?: never
          keep_after?: Json
          keep_before?: Json
          keep_id?: string
          merged_at?: string
          merged_by?: string
          moved?: Json
          moved_counts?: Json
          other_id?: string
          other_reply_token?: string | null
          removed?: Json
          undo_until?: string
          undone_at?: string | null
          undone_by?: string | null
          unread_handed?: number
        }
        Relationships: [
          {
            foreignKeyName: "contact_merges_keep_fkey"
            columns: ["account_id", "keep_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "contact_merges_other_fkey"
            columns: ["account_id", "other_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      contact_relationships: {
        Row: {
          account_id: string
          contact_can_pick_up: boolean
          contact_form: string | null
          contact_id: string
          contact_is_emergency: boolean
          created_at: string
          custom_label: string | null
          id: string
          label_key: string
          related_can_pick_up: boolean
          related_contact_id: string
          related_form: string | null
          related_is_emergency: boolean
          updated_at: string
        }
        Insert: {
          account_id: string
          contact_can_pick_up?: boolean
          contact_form?: string | null
          contact_id: string
          contact_is_emergency?: boolean
          created_at?: string
          custom_label?: string | null
          id?: string
          label_key: string
          related_can_pick_up?: boolean
          related_contact_id: string
          related_form?: string | null
          related_is_emergency?: boolean
          updated_at?: string
        }
        Update: {
          account_id?: string
          contact_can_pick_up?: boolean
          contact_form?: string | null
          contact_id?: string
          contact_is_emergency?: boolean
          created_at?: string
          custom_label?: string | null
          id?: string
          label_key?: string
          related_can_pick_up?: boolean
          related_contact_id?: string
          related_form?: string | null
          related_is_emergency?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_relationships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_relationships_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "contact_relationships_related_fkey"
            columns: ["account_id", "related_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          account_id: string
          contact_id: string
          tag_id: string
        }
        Insert: {
          account_id: string
          contact_id: string
          tag_id: string
        }
        Update: {
          account_id?: string
          contact_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          attribution: Json
          author_id: string | null
          author_kind: string | null
          company_name: string | null
          created_at: string
          custom: Json
          dnd: Json
          email: string | null
          email_key: string | null
          first_name: string | null
          holds_shared_number: boolean
          id: string
          language: string | null
          language_hint_kept_at: string | null
          language_set_at: string | null
          language_source: string | null
          last_language_signal: string | null
          last_language_signal_at: string | null
          last_language_signal_source: string | null
          last_name: string | null
          marketing_email_opted_out_at: string | null
          merged_at: string | null
          merged_into: string | null
          name_key: string | null
          phone: string | null
          phone_country_unconfirmed: boolean
          phone_key: string | null
          phone_national: string | null
          reactivation_sent_at: string | null
          search_name: string | null
          sort_name: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          attribution?: Json
          author_id?: string | null
          author_kind?: string | null
          company_name?: string | null
          created_at?: string
          custom?: Json
          dnd?: Json
          email?: string | null
          email_key?: string | null
          first_name?: string | null
          holds_shared_number?: boolean
          id?: string
          language?: string | null
          language_hint_kept_at?: string | null
          language_set_at?: string | null
          language_source?: string | null
          last_language_signal?: string | null
          last_language_signal_at?: string | null
          last_language_signal_source?: string | null
          last_name?: string | null
          marketing_email_opted_out_at?: string | null
          merged_at?: string | null
          merged_into?: string | null
          name_key?: string | null
          phone?: string | null
          phone_country_unconfirmed?: boolean
          phone_key?: string | null
          phone_national?: string | null
          reactivation_sent_at?: string | null
          search_name?: string | null
          sort_name?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          attribution?: Json
          author_id?: string | null
          author_kind?: string | null
          company_name?: string | null
          created_at?: string
          custom?: Json
          dnd?: Json
          email?: string | null
          email_key?: string | null
          first_name?: string | null
          holds_shared_number?: boolean
          id?: string
          language?: string | null
          language_hint_kept_at?: string | null
          language_set_at?: string | null
          language_source?: string | null
          last_language_signal?: string | null
          last_language_signal_at?: string | null
          last_language_signal_source?: string | null
          last_name?: string | null
          marketing_email_opted_out_at?: string | null
          merged_at?: string | null
          merged_into?: string | null
          name_key?: string | null
          phone?: string | null
          phone_country_unconfirmed?: boolean
          phone_key?: string | null
          phone_national?: string | null
          reactivation_sent_at?: string | null
          search_name?: string | null
          sort_name?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_merged_into_fkey"
            columns: ["account_id", "merged_into"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string
          assigned_to: string | null
          contact_archived: boolean
          contact_id: string
          created_at: string
          id: string
          inbox_visible: boolean | null
          last_message_at: string | null
          reply_token: string | null
          reply_token_revoked_at: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          contact_archived?: boolean
          contact_id: string
          created_at?: string
          id?: string
          inbox_visible?: boolean | null
          last_message_at?: string | null
          reply_token?: string | null
          reply_token_revoked_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          contact_archived?: boolean
          contact_id?: string
          created_at?: string
          id?: string
          inbox_visible?: boolean | null
          last_message_at?: string | null
          reply_token?: string | null
          reply_token_revoked_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          account_id: string
          blueprint_key: string | null
          created_at: string
          data_type: string
          field_key: string
          id: string
          model: string
          name: string
          options: Json
          origin: string
          position: number
        }
        Insert: {
          account_id: string
          blueprint_key?: string | null
          created_at?: string
          data_type: string
          field_key: string
          id?: string
          model: string
          name: string
          options?: Json
          origin?: string
          position?: number
        }
        Update: {
          account_id?: string
          blueprint_key?: string | null
          created_at?: string
          data_type?: string
          field_key?: string
          id?: string
          model?: string
          name?: string
          options?: Json
          origin?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_values: {
        Row: {
          account_id: string
          id: string
          name: string
          value: string
          value_key: string
        }
        Insert: {
          account_id: string
          id?: string
          name: string
          value?: string
          value_key: string
        }
        Update: {
          account_id?: string
          id?: string
          name?: string
          value?: string
          value_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_values_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requests: {
        Row: {
          account_id: string
          channel: string
          client_group_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          items: Json
          language: string
          revoked_at: string | null
          revoked_by: string | null
          sent_at: string | null
          start_day: string | null
          starts_today: number
          token_hash: string
        }
        Insert: {
          account_id: string
          channel: string
          client_group_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id: string
          items: Json
          language: string
          revoked_at?: string | null
          revoked_by?: string | null
          sent_at?: string | null
          start_day?: string | null
          starts_today?: number
          token_hash: string
        }
        Update: {
          account_id?: string
          channel?: string
          client_group_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          items?: Json
          language?: string
          revoked_at?: string | null
          revoked_by?: string | null
          sent_at?: string | null
          start_day?: string | null
          starts_today?: number
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "document_requests_group_fkey"
            columns: ["account_id", "client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      document_requirement_skips: {
        Row: {
          account_id: string
          category: string
          contact_id: string
          created_at: string
          id: string
          skipped_by: string
          unskipped_at: string | null
          unskipped_by: string | null
        }
        Insert: {
          account_id: string
          category: string
          contact_id: string
          created_at?: string
          id?: string
          skipped_by: string
          unskipped_at?: string | null
          unskipped_by?: string | null
        }
        Update: {
          account_id?: string
          category?: string
          contact_id?: string
          created_at?: string
          id?: string
          skipped_by?: string
          unskipped_at?: string | null
          unskipped_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_requirement_skips_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirement_skips_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      document_share_downloads: {
        Row: {
          account_id: string
          created_at: string
          id: string
          ip_hash: string
          share_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          ip_hash: string
          share_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          ip_hash?: string
          share_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_share_downloads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_share_downloads_share_fkey"
            columns: ["account_id", "share_id"]
            isOneToOne: false
            referencedRelation: "document_share_timeline"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "document_share_downloads_share_fkey"
            columns: ["account_id", "share_id"]
            isOneToOne: false
            referencedRelation: "document_shares"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      document_shares: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          document_id: string
          expires_at: string
          first_opened_at: string | null
          id: string
          open_count: number
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
          version_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          document_id: string
          expires_at: string
          first_opened_at?: string | null
          id?: string
          open_count?: number
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
          version_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          document_id?: string
          expires_at?: string
          first_opened_at?: string | null
          id?: string
          open_count?: number
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_shares_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_document_fkey"
            columns: ["account_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "document_shares_version_fkey"
            columns: ["account_id", "document_id", "version_id"]
            isOneToOne: false
            referencedRelation: "document_scan_timeline"
            referencedColumns: ["account_id", "document_id", "id"]
          },
          {
            foreignKeyName: "document_shares_version_fkey"
            columns: ["account_id", "document_id", "version_id"]
            isOneToOne: false
            referencedRelation: "document_version_timeline"
            referencedColumns: ["account_id", "document_id", "id"]
          },
          {
            foreignKeyName: "document_shares_version_fkey"
            columns: ["account_id", "document_id", "version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["account_id", "document_id", "id"]
          },
        ]
      }
      document_versions: {
        Row: {
          account_id: string
          bytes: number
          content_type: string
          created_at: string
          document_id: string
          id: string
          original_name: string | null
          scan_attempts: number
          scan_signature: string | null
          scan_status: string
          scan_tried_at: string | null
          scanned_at: string | null
          sha256: string | null
          status: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          account_id: string
          bytes: number
          content_type: string
          created_at?: string
          document_id: string
          id?: string
          original_name?: string | null
          scan_attempts?: number
          scan_signature?: string | null
          scan_status?: string
          scan_tried_at?: string | null
          scanned_at?: string | null
          sha256?: string | null
          status: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          account_id?: string
          bytes?: number
          content_type?: string
          created_at?: string
          document_id?: string
          id?: string
          original_name?: string | null
          scan_attempts?: number
          scan_signature?: string | null
          scan_status?: string
          scan_tried_at?: string | null
          scanned_at?: string | null
          sha256?: string | null
          status?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_document_fkey"
            columns: ["account_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      documents: {
        Row: {
          account_id: string
          category: string
          client_group_id: string | null
          client_visible: boolean
          contact_id: string | null
          created_at: string
          created_by: string
          current_version_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          expires_on: string | null
          id: string
          opportunity_id: string | null
          owners_only: boolean
          place_id: string | null
          request_id: string | null
          request_item_key: string | null
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          category: string
          client_group_id?: string | null
          client_visible?: boolean
          contact_id?: string | null
          created_at?: string
          created_by: string
          current_version_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          expires_on?: string | null
          id?: string
          opportunity_id?: string | null
          owners_only?: boolean
          place_id?: string | null
          request_id?: string | null
          request_item_key?: string | null
          source: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          category?: string
          client_group_id?: string | null
          client_visible?: boolean
          contact_id?: string | null
          created_at?: string
          created_by?: string
          current_version_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          expires_on?: string | null
          id?: string
          opportunity_id?: string | null
          owners_only?: boolean
          place_id?: string | null
          request_id?: string | null
          request_item_key?: string | null
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "documents_current_version_fkey"
            columns: ["id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "document_scan_timeline"
            referencedColumns: ["document_id", "id"]
          },
          {
            foreignKeyName: "documents_current_version_fkey"
            columns: ["id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "document_version_timeline"
            referencedColumns: ["document_id", "id"]
          },
          {
            foreignKeyName: "documents_current_version_fkey"
            columns: ["id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["document_id", "id"]
          },
          {
            foreignKeyName: "documents_group_fkey"
            columns: ["account_id", "client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "documents_opportunity_fkey"
            columns: ["account_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "documents_place_fkey"
            columns: ["account_id", "place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "documents_request_fkey"
            columns: ["account_id", "request_id"]
            isOneToOne: false
            referencedRelation: "document_requests"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      equipment: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          installed_on: string | null
          make: string | null
          model: string | null
          name: string
          notes: string | null
          place_id: string
          replaces_id: string | null
          serial: string | null
          updated_at: string
          warranty_until: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          installed_on?: string | null
          make?: string | null
          model?: string | null
          name: string
          notes?: string | null
          place_id: string
          replaces_id?: string | null
          serial?: string | null
          updated_at?: string
          warranty_until?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          installed_on?: string | null
          make?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          place_id?: string
          replaces_id?: string | null
          serial?: string | null
          updated_at?: string
          warranty_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_place_fkey"
            columns: ["account_id", "place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "equipment_replaces_fkey"
            columns: ["place_id", "replaces_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["place_id", "id"]
          },
        ]
      }
      events: {
        Row: {
          account_id: string | null
          actor_id: string | null
          actor_type: string
          created_at: string
          id: number
          payload: Json
          type: string
        }
        Insert: {
          account_id?: string | null
          actor_id?: string | null
          actor_type: string
          created_at?: string
          id?: never
          payload?: Json
          type: string
        }
        Update: {
          account_id?: string | null
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: never
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          account_id: string
          answers: Json
          answers_hash: string | null
          attribution: Json
          author_kind: string
          consent: Json | null
          contact_id: string | null
          created_at: string
          form_id: string
          id: string
          instant_reply_sent_at: string | null
          ip_hash: string | null
          locale: string | null
          processing_error: string | null
          spam_reason: string | null
          user_agent: string | null
        }
        Insert: {
          account_id: string
          answers?: Json
          answers_hash?: string | null
          attribution?: Json
          author_kind?: string
          consent?: Json | null
          contact_id?: string | null
          created_at?: string
          form_id: string
          id?: string
          instant_reply_sent_at?: string | null
          ip_hash?: string | null
          locale?: string | null
          processing_error?: string | null
          spam_reason?: string | null
          user_agent?: string | null
        }
        Update: {
          account_id?: string
          answers?: Json
          answers_hash?: string | null
          attribution?: Json
          author_kind?: string
          consent?: Json | null
          contact_id?: string | null
          created_at?: string
          form_id?: string
          id?: string
          instant_reply_sent_at?: string | null
          ip_hash?: string | null
          locale?: string | null
          processing_error?: string | null
          spam_reason?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          account_id: string
          blueprint_key: string | null
          created_at: string
          fields: Json
          id: string
          locale_default: string
          name: string
          notify_emails: string[]
          origin: string
          public_id: string
          redirect_url: string | null
          status: string
          success_message: string | null
          success_mode: string
          theme: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          blueprint_key?: string | null
          created_at?: string
          fields?: Json
          id?: string
          locale_default?: string
          name: string
          notify_emails?: string[]
          origin?: string
          public_id: string
          redirect_url?: string | null
          status?: string
          success_message?: string | null
          success_mode?: string
          theme?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          blueprint_key?: string | null
          created_at?: string
          fields?: Json
          id?: string
          locale_default?: string
          name?: string
          notify_emails?: string[]
          origin?: string
          public_id?: string
          redirect_url?: string | null
          status?: string
          success_message?: string | null
          success_mode?: string
          theme?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forms_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      forwarded_calls: {
        Row: {
          account_id: string
          called_e164: string
          caller_e164: string | null
          created_at: string
          id: string
          kind: string
          phone_number_id: string | null
        }
        Insert: {
          account_id: string
          called_e164: string
          caller_e164?: string | null
          created_at?: string
          id?: string
          kind: string
          phone_number_id?: string | null
        }
        Update: {
          account_id?: string
          called_e164?: string
          caller_e164?: string | null
          created_at?: string
          id?: string
          kind?: string
          phone_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forwarded_calls_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forwarded_calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_emails: {
        Row: {
          account_id: string
          attachment_count: number
          auth: Json
          conversation_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          from_email: string
          from_name: string | null
          hold_reason: string | null
          id: string
          message_id: string | null
          provider_email_id: string
          received_at: string
          status: string
          subject: string | null
          text: string
          to_email: string
        }
        Insert: {
          account_id: string
          attachment_count?: number
          auth?: Json
          conversation_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          from_email: string
          from_name?: string | null
          hold_reason?: string | null
          id?: string
          message_id?: string | null
          provider_email_id: string
          received_at: string
          status: string
          subject?: string | null
          text?: string
          to_email: string
        }
        Update: {
          account_id?: string
          attachment_count?: number
          auth?: Json
          conversation_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          from_email?: string
          from_name?: string | null
          hold_reason?: string | null
          id?: string
          message_id?: string | null
          provider_email_id?: string
          received_at?: string
          status?: string
          subject?: string | null
          text?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_emails_conversation_fkey"
            columns: ["account_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "inbound_emails_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_never_log: {
        Row: {
          account_id: string
          added_by: string
          created_at: string
          id: string
          kind: string
          pattern: string
        }
        Insert: {
          account_id: string
          added_by: string
          created_at?: string
          id?: string
          kind: string
          pattern: string
        }
        Update: {
          account_id?: string
          added_by?: string
          created_at?: string
          id?: string
          kind?: string
          pattern?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_never_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          account_id: string | null
          attempts: number
          claim_token: string | null
          created_at: string
          finished_at: string | null
          id: string
          idempotency_key: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          payload: Json
          run_after: string
          state: string
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          attempts?: number
          claim_token?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          idempotency_key: string
          kind: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts: number
          payload?: Json
          run_after?: string
          state?: string
          timeout_ms: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          attempts?: number
          claim_token?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          payload?: Json
          run_after?: string
          state?: string
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          account_id: string | null
          agency_id: string | null
          created_at: string
          id: string
          permissions: Json
          role: string
          scope: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          agency_id?: string | null
          created_at?: string
          id?: string
          permissions?: Json
          role: string
          scope: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          agency_id?: string | null
          created_at?: string
          id?: string
          permissions?: Json
          role?: string
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          account_id: string
          author_id: string | null
          author_kind: string
          body: string
          channel: string
          conversation_id: string
          created_at: string
          direction: string
          error: string | null
          id: string
          meta: Json
          provider_message_id: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          author_id?: string | null
          author_kind: string
          body: string
          channel: string
          conversation_id: string
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          meta?: Json
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          author_id?: string | null
          author_kind?: string
          body?: string
          channel?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          meta?: Json
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          account_id: string
          author_id: string | null
          body: string
          contact_id: string
          created_at: string
          id: string
          pinned: boolean
        }
        Insert: {
          account_id: string
          author_id?: string | null
          body: string
          contact_id: string
          created_at?: string
          id?: string
          pinned?: boolean
        }
        Update: {
          account_id?: string
          author_id?: string | null
          body?: string
          contact_id?: string
          created_at?: string
          id?: string
          pinned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          account_id: string
          assigned_to: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          custom: Json
          id: string
          monetary_value: number
          name: string
          pipeline_id: string
          quote_followup_sent_at: string | null
          quote_followup_sms_failed_at: string | null
          stage_changed_at: string
          stage_id: string
          status: string
          status_changed_at: string
          updated_at: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          custom?: Json
          id?: string
          monetary_value?: number
          name: string
          pipeline_id: string
          quote_followup_sent_at?: string | null
          quote_followup_sms_failed_at?: string | null
          stage_changed_at?: string
          stage_id: string
          status?: string
          status_changed_at?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          custom?: Json
          id?: string
          monetary_value?: number
          name?: string
          pipeline_id?: string
          quote_followup_sent_at?: string | null
          quote_followup_sms_failed_at?: string | null
          stage_changed_at?: string
          stage_id?: string
          status?: string
          status_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_heartbeats: {
        Row: {
          alerted_at: string | null
          consecutive_failures: number
          key: string
          last_error: string | null
          last_error_at: string | null
          last_ok_at: string | null
          updated_at: string
        }
        Insert: {
          alerted_at?: string | null
          consecutive_failures?: number
          key: string
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          updated_at?: string
        }
        Update: {
          alerted_at?: string | null
          consecutive_failures?: number
          key?: string
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      owner_line_enrollments: {
        Row: {
          account_id: string
          created_at: string
          e164: string | null
          failed_attempts: number
          id: string
          locked_until: string | null
          pin_hash: string | null
          pin_set_at: string | null
          user_id: string
          verified_at: string | null
          verify_attempts: number
          verify_code_hash: string | null
          verify_expires_at: string | null
          verify_starts: number
          verify_window_started_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          e164?: string | null
          failed_attempts?: number
          id?: string
          locked_until?: string | null
          pin_hash?: string | null
          pin_set_at?: string | null
          user_id: string
          verified_at?: string | null
          verify_attempts?: number
          verify_code_hash?: string | null
          verify_expires_at?: string | null
          verify_starts?: number
          verify_window_started_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          e164?: string | null
          failed_attempts?: number
          id?: string
          locked_until?: string | null
          pin_hash?: string | null
          pin_set_at?: string | null
          user_id?: string
          verified_at?: string | null
          verify_attempts?: number
          verify_code_hash?: string | null
          verify_expires_at?: string | null
          verify_starts?: number
          verify_window_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_line_enrollments_member_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: true
            referencedRelation: "memberships"
            referencedColumns: ["account_id", "user_id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          account_id: string
          created_at: string
          e164: string
          id: string
          status: string
          telnyx_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          e164: string
          id?: string
          status?: string
          telnyx_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          e164?: string
          id?: string
          status?: string
          telnyx_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          account_id: string
          blueprint_key: string | null
          id: string
          name: string
          origin: string
          pipeline_id: string
          position: number
        }
        Insert: {
          account_id: string
          blueprint_key?: string | null
          id?: string
          name: string
          origin?: string
          pipeline_id: string
          position: number
        }
        Update: {
          account_id?: string
          blueprint_key?: string | null
          id?: string
          name?: string
          origin?: string
          pipeline_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          account_id: string
          blueprint_key: string | null
          created_at: string
          id: string
          name: string
          origin: string
          position: number
        }
        Insert: {
          account_id: string
          blueprint_key?: string | null
          created_at?: string
          id?: string
          name: string
          origin?: string
          position?: number
        }
        Update: {
          account_id?: string
          blueprint_key?: string | null
          created_at?: string
          id?: string
          name?: string
          origin?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          account_id: string
          address: string | null
          archived_at: string | null
          city: string | null
          client_group_id: string | null
          contact_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          directions: string | null
          id: string
          label: string | null
          landmark: string | null
          postal_code: string | null
          region: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          address?: string | null
          archived_at?: string | null
          city?: string | null
          client_group_id?: string | null
          contact_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          directions?: string | null
          id?: string
          label?: string | null
          landmark?: string | null
          postal_code?: string | null
          region?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          address?: string | null
          archived_at?: string | null
          city?: string | null
          client_group_id?: string | null
          contact_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          directions?: string | null
          id?: string
          label?: string | null
          landmark?: string | null
          postal_code?: string | null
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "places_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "places_group_fkey"
            columns: ["account_id", "client_group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      plans: {
        Row: {
          agency_id: string
          allowances: Json
          archived_at: string | null
          created_at: string
          currency: string
          features: Json
          id: string
          monthly_price_cents: number
          name: string
          overage_cents: Json
          stripe_price_ids: Json
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          allowances: Json
          archived_at?: string | null
          created_at?: string
          currency?: string
          features: Json
          id?: string
          monthly_price_cents: number
          name: string
          overage_cents: Json
          stripe_price_ids: Json
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          allowances?: Json
          archived_at?: string | null
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          monthly_price_cents?: number
          name?: string
          overage_cents?: Json
          stripe_price_ids?: Json
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          account_id: string
          applied_payload: Json | null
          applied_ref: Json | null
          call_id: string | null
          contact_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          evidence: string
          evidence_lang: string | null
          evidence_ref: Json
          expired_reason: string | null
          expires_at: string
          id: string
          kind: string
          payload: Json
          source: string
          status: string
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          account_id: string
          applied_payload?: Json | null
          applied_ref?: Json | null
          call_id?: string | null
          contact_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          evidence: string
          evidence_lang?: string | null
          evidence_ref?: Json
          expired_reason?: string | null
          expires_at: string
          id?: string
          kind: string
          payload: Json
          source: string
          status?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          account_id?: string
          applied_payload?: Json | null
          applied_ref?: Json | null
          call_id?: string | null
          contact_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          evidence?: string
          evidence_lang?: string | null
          evidence_ref?: Json
          expired_reason?: string | null
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          source?: string
          status?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_call_fkey"
            columns: ["account_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "proposals_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      record_changes: {
        Row: {
          account_id: string
          after: Json | null
          author_id: string | null
          author_kind: string
          before: Json | null
          client_group_id: string | null
          contact_id: string | null
          created_at: string
          field: string | null
          id: number
          op: string
          record_id: string
          record_type: string
          via: string | null
          xact: number
        }
        Insert: {
          account_id: string
          after?: Json | null
          author_id?: string | null
          author_kind: string
          before?: Json | null
          client_group_id?: string | null
          contact_id?: string | null
          created_at?: string
          field?: string | null
          id?: never
          op: string
          record_id: string
          record_type: string
          via?: string | null
          xact?: number
        }
        Update: {
          account_id?: string
          after?: Json | null
          author_id?: string | null
          author_kind?: string
          before?: Json | null
          client_group_id?: string | null
          contact_id?: string | null
          created_at?: string
          field?: string | null
          id?: never
          op?: string
          record_id?: string
          record_type?: string
          via?: string | null
          xact?: number
        }
        Relationships: [
          {
            foreignKeyName: "record_changes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      record_summaries: {
        Row: {
          account_id: string
          body: string | null
          contact_id: string
          created_at: string
          generated_at: string | null
          generating_until: string | null
          id: string
          input_digest: string | null
          language: string
          last_forced_at: string | null
          lease_id: string | null
          model: string | null
        }
        Insert: {
          account_id: string
          body?: string | null
          contact_id: string
          created_at?: string
          generated_at?: string | null
          generating_until?: string | null
          id?: string
          input_digest?: string | null
          language: string
          last_forced_at?: string | null
          lease_id?: string | null
          model?: string | null
        }
        Update: {
          account_id?: string
          body?: string | null
          contact_id?: string
          created_at?: string
          generated_at?: string | null
          generating_until?: string | null
          id?: string
          input_digest?: string | null
          language?: string
          last_forced_at?: string | null
          lease_id?: string | null
          model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "record_summaries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_summaries_contact_fkey"
            columns: ["account_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      screened_calls: {
        Row: {
          account_id: string | null
          called_e164: string
          caller_e164: string | null
          created_at: string
          id: string
          phone_number_id: string | null
          reason: string
        }
        Insert: {
          account_id?: string | null
          called_e164: string
          caller_e164?: string | null
          created_at?: string
          id?: string
          phone_number_id?: string | null
          reason: string
        }
        Update: {
          account_id?: string | null
          called_e164?: string
          caller_e164?: string | null
          created_at?: string
          id?: string
          phone_number_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "screened_calls_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screened_calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      site_traffic_breakdown: {
        Row: {
          account_id: string
          day: string
          dimension: string
          pageviews: number
          site_id: string
          value: string
          visitors: number
        }
        Insert: {
          account_id: string
          day: string
          dimension: string
          pageviews: number
          site_id: string
          value: string
          visitors: number
        }
        Update: {
          account_id?: string
          day?: string
          dimension?: string
          pageviews?: number
          site_id?: string
          value?: string
          visitors?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_traffic_breakdown_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_traffic_breakdown_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_traffic_daily: {
        Row: {
          account_id: string
          day: string
          pageviews: number
          site_id: string
          visitors: number
        }
        Insert: {
          account_id: string
          day: string
          pageviews: number
          site_id: string
          visitors: number
        }
        Update: {
          account_id?: string
          day?: string
          pageviews?: number
          site_id?: string
          visitors?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_traffic_daily_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_traffic_daily_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          account_id: string
          analytics_enabled_at: string | null
          created_at: string
          domain: string
          id: string
          last_synced_day: string | null
          vercel_project_id: string
        }
        Insert: {
          account_id: string
          analytics_enabled_at?: string | null
          created_at?: string
          domain: string
          id?: string
          last_synced_day?: string | null
          vercel_project_id: string
        }
        Update: {
          account_id?: string
          analytics_enabled_at?: string | null
          created_at?: string
          domain?: string
          id?: string
          last_synced_day?: string | null
          vercel_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          event_id: string
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          event_id?: string
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          account_id: string
          blueprint_key: string | null
          id: string
          name: string
          origin: string
        }
        Insert: {
          account_id: string
          blueprint_key?: string | null
          id?: string
          name: string
          origin?: string
        }
        Update: {
          account_id?: string
          blueprint_key?: string | null
          id?: string
          name?: string
          origin?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          account_id: string
          assigned_to: string | null
          call_id: string | null
          closure_kind: string | null
          closure_on: string | null
          completed_at: string | null
          consent_event_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          document_expiry_id: string | null
          document_expiry_on: string | null
          document_request_id: string | null
          document_request_kind: string | null
          due_at: string | null
          id: string
          title: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          call_id?: string | null
          closure_kind?: string | null
          closure_on?: string | null
          completed_at?: string | null
          consent_event_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          document_expiry_id?: string | null
          document_expiry_on?: string | null
          document_request_id?: string | null
          document_request_kind?: string | null
          due_at?: string | null
          id?: string
          title: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          call_id?: string | null
          closure_kind?: string | null
          closure_on?: string | null
          completed_at?: string | null
          consent_event_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          document_expiry_id?: string | null
          document_expiry_on?: string | null
          document_request_id?: string | null
          document_request_kind?: string | null
          due_at?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_call_fkey"
            columns: ["account_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "tasks_consent_event_fkey"
            columns: ["account_id", "consent_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_document_expiry_fkey"
            columns: ["account_id", "document_expiry_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "tasks_document_request_fkey"
            columns: ["account_id", "document_request_id"]
            isOneToOne: false
            referencedRelation: "document_requests"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      usage_events: {
        Row: {
          account_id: string
          created_at: string
          id: string
          meter: string
          occurred_at: string
          quantity: number
          reported_at: string | null
          source_ref: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          meter: string
          occurred_at: string
          quantity: number
          reported_at?: string | null
          source_ref: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          meter?: string
          occurred_at?: string
          quantity?: number
          reported_at?: string | null
          source_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          clerk_user_id: string
          created_at: string
          email: string
          id: string
          language: string | null
          name: string | null
          theme: string | null
        }
        Insert: {
          clerk_user_id: string
          created_at?: string
          email: string
          id?: string
          language?: string | null
          name?: string | null
          theme?: string | null
        }
        Update: {
          clerk_user_id?: string
          created_at?: string
          email?: string
          id?: string
          language?: string | null
          name?: string | null
          theme?: string | null
        }
        Relationships: []
      }
      voice_knowledge_snapshots: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          id: string
          payload: Json
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          id?: string
          payload: Json
          version: number
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          id?: string
          payload?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "voice_knowledge_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_profiles: {
        Row: {
          account_id: string
          after_hours: string
          booking_enabled: boolean
          business_hours: Json | null
          concierge_enabled: boolean
          concierge_form_id: string | null
          created_at: string
          disclosure: string
          enabled: boolean
          facts: string
          forward_calls: boolean
          greeting_en: string
          greeting_es: string
          id: string
          languages: string
          persona_name: string
          public_id: string | null
          services: string
          textback_body: string
          textback_body_es: string | null
          textback_body_es_basis: string | null
          textback_enabled: boolean
          trade_module: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          after_hours?: string
          booking_enabled?: boolean
          business_hours?: Json | null
          concierge_enabled?: boolean
          concierge_form_id?: string | null
          created_at?: string
          disclosure?: string
          enabled?: boolean
          facts?: string
          forward_calls?: boolean
          greeting_en?: string
          greeting_es?: string
          id?: string
          languages?: string
          persona_name?: string
          public_id?: string | null
          services?: string
          textback_body?: string
          textback_body_es?: string | null
          textback_body_es_basis?: string | null
          textback_enabled?: boolean
          trade_module?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          after_hours?: string
          booking_enabled?: boolean
          business_hours?: Json | null
          concierge_enabled?: boolean
          concierge_form_id?: string | null
          created_at?: string
          disclosure?: string
          enabled?: boolean
          facts?: string
          forward_calls?: boolean
          greeting_en?: string
          greeting_es?: string
          id?: string
          languages?: string
          persona_name?: string
          public_id?: string | null
          services?: string
          textback_body?: string
          textback_body_es?: string | null
          textback_body_es_basis?: string | null
          textback_enabled?: boolean
          trade_module?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_profiles_concierge_form_id_fkey"
            columns: ["concierge_form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_services: {
        Row: {
          account_id: string
          amount_cents: number | null
          amount_max_cents: number | null
          created_at: string
          description_en: string | null
          description_es: string | null
          id: string
          name_en: string
          name_es: string | null
          position: number
          price_kind: string
          unit_en: string | null
          unit_es: string | null
        }
        Insert: {
          account_id: string
          amount_cents?: number | null
          amount_max_cents?: number | null
          created_at?: string
          description_en?: string | null
          description_es?: string | null
          id?: string
          name_en: string
          name_es?: string | null
          position: number
          price_kind: string
          unit_en?: string | null
          unit_es?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number | null
          amount_max_cents?: number | null
          created_at?: string
          description_en?: string | null
          description_es?: string | null
          id?: string
          name_en?: string
          name_es?: string | null
          position?: number
          price_kind?: string
          unit_en?: string | null
          unit_es?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_services_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_web_sessions: {
        Row: {
          account_id: string
          created_at: string
          id: string
          ip_hash: string
          origin: string | null
          ticket_nonce: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          ip_hash: string
          origin?: string | null
          ticket_nonce: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          ip_hash?: string
          origin?: string | null
          ticket_nonce?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_web_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      document_scan_timeline: {
        Row: {
          account_id: string | null
          category: string | null
          client_group_id: string | null
          contact_id: string | null
          deleted_at: string | null
          document_id: string | null
          id: string | null
          scan_signature: string | null
          scan_status: string | null
          scanned_at: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_document_fkey"
            columns: ["account_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      document_share_timeline: {
        Row: {
          account_id: string | null
          category: string | null
          client_group_id: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          document_id: string | null
          expires_at: string | null
          first_opened_at: string | null
          id: string | null
          revoked_at: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_shares_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_document_fkey"
            columns: ["account_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      document_version_timeline: {
        Row: {
          account_id: string | null
          category: string | null
          client_group_id: string | null
          contact_id: string | null
          created_at: string | null
          deleted_at: string | null
          document_id: string | null
          id: string | null
          title: string | null
          uploaded_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_document_fkey"
            columns: ["account_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
    }
    Functions: {
      access_log_page: {
        Args: {
          p_account_id: string
          p_before_id: string
          p_before_started: string
          p_limit: number
        }
        Returns: Json
      }
      add_contact_to_group: {
        Args: {
          p_account_id: string
          p_contact_id: string
          p_group_id: string
          p_role?: string
        }
        Returns: Json
      }
      agency_visit_live: {
        Args: { p_account_id: string; p_actor: string; p_session: string }
        Returns: string
      }
      ai_contact_held_by: {
        Args: { p_account_id: string; p_act_id: string }
        Returns: string[]
      }
      ai_gate_check: {
        Args: { p_account: string; p_day: string; p_month: string }
        Returns: Json
      }
      ai_ledger_record: {
        Args: {
          p_account: string
          p_cost: number
          p_day: string
          p_feature: string
          p_in: number
          p_latency: number
          p_model: string
          p_month: string
          p_out: number
          p_outcome: string
        }
        Returns: undefined
      }
      append_consent_event: {
        Args: {
          p_account_id: string
          p_action: string
          p_actor_id: string
          p_address: string
          p_channel: string
          p_contact_id: string
          p_evidence: Json
          p_expect_id: string
          p_guard: string
          p_method: string
          p_note: string
          p_occurred_at: string
          p_source_ref: string
        }
        Returns: {
          event_id: string
          outcome: string
          prior_action: string
          prior_evidence: Json
          prior_id: string
          prior_method: string
        }[]
      }
      claim_calendar_feed_fetch: {
        Args: { p_max: number; p_token_hash: string; p_window_seconds: number }
        Returns: Json
      }
      claim_document_share_download: {
        Args: {
          p_account_id: string
          p_ip_hash: string
          p_link_max: number
          p_max: number
          p_share_id: string
          p_window_seconds: number
        }
        Returns: Json
      }
      claim_jobs: {
        Args: { p_kinds: string[]; p_limit?: number }
        Returns: {
          account_id: string | null
          attempts: number
          claim_token: string | null
          created_at: string
          finished_at: string | null
          id: string
          idempotency_key: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          payload: Json
          run_after: string
          state: string
          timeout_ms: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_record_summary: {
        Args: {
          p_account: string
          p_contact: string
          p_digest: string
          p_force: boolean
          p_language: string
        }
        Returns: Json
      }
      concierge_append_turns: {
        Args: { p_conversation_id: string; p_turns: Json }
        Returns: number
      }
      concierge_claim_turn: {
        Args: { p_conversation_id: string; p_max: number }
        Returns: number
      }
      concierge_enable: {
        Args: {
          p_account_id: string
          p_form_id: string
          p_new_public_id: string
        }
        Returns: string
      }
      consume_alert_phone_verification: {
        Args: { p_id: string }
        Returns: boolean
      }
      contact_delete_blockers: {
        Args: { p_account_id: string; p_contact_ids: string[] }
        Returns: {
          contact_id: string
          reasons: string[]
        }[]
      }
      contact_merge_preview: {
        Args: { p_account_id: string; p_keep: string; p_other: string }
        Returns: Json
      }
      contacts_matching: {
        Args: {
          p_account_id: string
          p_national?: string
          p_phone_keys?: string[]
          p_text: string
          p_tokens?: string[]
        }
        Returns: {
          account_id: string
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          attribution: Json
          author_id: string | null
          author_kind: string | null
          company_name: string | null
          created_at: string
          custom: Json
          dnd: Json
          email: string | null
          email_key: string | null
          first_name: string | null
          holds_shared_number: boolean
          id: string
          language: string | null
          language_hint_kept_at: string | null
          language_set_at: string | null
          language_source: string | null
          last_language_signal: string | null
          last_language_signal_at: string | null
          last_language_signal_source: string | null
          last_name: string | null
          marketing_email_opted_out_at: string | null
          merged_at: string | null
          merged_into: string | null
          name_key: string | null
          phone: string | null
          phone_country_unconfirmed: boolean
          phone_key: string | null
          phone_national: string | null
          reactivation_sent_at: string | null
          search_name: string | null
          sort_name: string | null
          source: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_group_with_member: {
        Args: {
          p_account_id: string
          p_contact_id: string
          p_kind: string
          p_name: string
          p_role?: string
        }
        Returns: Json
      }
      delete_empty_conversations: {
        Args: { p_account_id: string; p_contact_ids: string[] }
        Returns: {
          id: string
        }[]
      }
      delete_internal_contacts: {
        Args: { p_account_id: string; p_contact_ids: string[] }
        Returns: string[]
      }
      dismiss_duplicate_pair: {
        Args: { p_account_id: string; p_actor?: string; p_flag_id: string }
        Returns: Json
      }
      document_requirements: {
        Args: { p_account_id: string; p_contact_id: string; p_today: string }
        Returns: {
          category: string
          state: string
        }[]
      }
      document_space_used: { Args: { p_account_id: string }; Returns: number }
      duplicate_pairs_count: { Args: { p_account_id: string }; Returns: number }
      duplicate_pairs_of: {
        Args: { p_account_id: string; p_contact_id: string }
        Returns: {
          a_first_name: string
          a_last_name: string
          b_first_name: string
          b_last_name: string
          contact_a: string
          contact_b: string
          created_at: string
          id: string
          reason: string
          strength: number
        }[]
      }
      duplicate_pairs_page: {
        Args: {
          p_account_id: string
          p_after_created_at?: string
          p_after_id?: string
          p_after_strength?: number
          p_limit: number
        }
        Returns: {
          a_first_name: string
          a_last_name: string
          b_first_name: string
          b_last_name: string
          contact_a: string
          contact_b: string
          created_at: string
          id: string
          reason: string
          strength: number
        }[]
      }
      ensure_knowledge_snapshot: {
        Args: { p_account_id: string; p_payload: Json }
        Returns: number
      }
      go_live: {
        Args: {
          p_account_id: string
          p_actor_id: string
          p_phone_number_id: string
        }
        Returns: undefined
      }
      increment_conversation_unread: {
        Args: { p_account_id: string; p_conversation_id: string }
        Returns: undefined
      }
      list_pending_proposals_for_agency: {
        Args: { p_per_account: number }
        Returns: {
          account_id: string
          applied_payload: Json | null
          applied_ref: Json | null
          call_id: string | null
          contact_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          evidence: string
          evidence_lang: string | null
          evidence_ref: Json
          expired_reason: string | null
          expires_at: string
          id: string
          kind: string
          payload: Json
          source: string
          status: string
          undone_at: string | null
          undone_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_document_version_ready: {
        Args: {
          p_account_id: string
          p_bytes: number
          p_document_id: string
          p_sha256: string
          p_version_id: string
        }
        Returns: Json
      }
      merge_contacts: {
        Args: {
          p_account_id: string
          p_actor?: string
          p_choices: Json
          p_keep: string
          p_other: string
          p_seen: Json
        }
        Returns: Json
      }
      move_holding_thread: {
        Args: {
          p_account_id: string
          p_actor: string
          p_from_conversation: string
          p_to_conversation: string
          p_undo_of?: number
        }
        Returns: Json
      }
      note_agency_open: {
        Args: {
          p_account_id: string
          p_actor: string
          p_item_count: number
          p_kind: string
          p_record_id: string
          p_session: string
        }
        Returns: string
      }
      note_owner_line_call: {
        Args: {
          p_account_id: string
          p_actor: string
          p_actor_name: string
          p_call_id: string
          p_kinds: string[]
        }
        Returns: string
      }
      owner_line_answer_lookup: {
        Args: { p_account_id: string; p_caller_e164: string; p_max: number }
        Returns: Json
      }
      owner_line_attempt_pin: {
        Args: {
          p_candidate: string
          p_enrollment_id: string
          p_lock_minutes: number
        }
        Returns: Json
      }
      owner_line_attempt_verify: {
        Args: {
          p_account_id: string
          p_caller_e164: string
          p_code_hash: string
        }
        Returns: string
      }
      owner_line_session_check: {
        Args: {
          p_account_id: string
          p_max: number
          p_role: string
          p_user_id: string
        }
        Returns: Json
      }
      owner_line_start_verification: {
        Args: {
          p_account_id: string
          p_code_hash: string
          p_e164: string
          p_minutes: number
          p_user_id: string
        }
        Returns: string
      }
      put_back_contact_custom: {
        Args: {
          p_account_id: string
          p_contact_id: string
          p_expected: Json
          p_key: string
          p_value: Json
        }
        Returns: boolean
      }
      record_document_scan: {
        Args: {
          p_account_id: string
          p_signature: string
          p_verdict: string
          p_version_id: string
        }
        Returns: Json
      }
      record_event: {
        Args: { p_account_id: string; p_payload?: Json; p_type: string }
        Returns: undefined
      }
      record_heartbeat: {
        Args: { p_error?: string; p_key: string; p_ok: boolean }
        Returns: undefined
      }
      record_language_signal: {
        Args: {
          p_account: string
          p_at: string
          p_contact: string
          p_language: string
          p_source: string
        }
        Returns: boolean
      }
      release_member_assignments: {
        Args: { p_account_id: string; p_user_id: string }
        Returns: Json
      }
      remove_account_member: {
        Args: { p_account_id: string; p_user_id: string }
        Returns: string
      }
      remove_group_membership: {
        Args: { p_account_id: string; p_member_id: string }
        Returns: Json
      }
      replace_calendar_feed: {
        Args: {
          p_account_id: string
          p_created_by: string
          p_new_hash: string
          p_new_id: string
          p_user_id: string
        }
        Returns: Json
      }
      reserve_document_version: {
        Args: {
          p_account_id: string
          p_bytes: number
          p_content_type: string
          p_document_id: string
          p_original_name: string
          p_uploaded_by: string
        }
        Returns: Json
      }
      restore_calendar_feed: {
        Args: {
          p_account_id: string
          p_feed_id: string
          p_max_age_seconds: number
          p_replacement_id: string
          p_revoked_at: string
          p_user_id: string
        }
        Returns: string
      }
      restore_contact_on_sign: {
        Args: { p_account_id: string; p_contact_id: string; p_sign: string }
        Returns: boolean
      }
      restore_group_membership: {
        Args: { p_account_id: string; p_snapshot: Json }
        Returns: string
      }
      revoke_calendar_feed: {
        Args: { p_account_id: string; p_user_id: string }
        Returns: Json
      }
      save_voice_knowledge: {
        Args: {
          p_account_id: string
          p_actor: string
          p_base_version: number
          p_parts: Json
          p_payload: Json
        }
        Returns: Json
      }
      set_account_member_role: {
        Args: { p_account_id: string; p_role: string; p_user_id: string }
        Returns: string
      }
      set_contacts_business: {
        Args: {
          p_account_id: string
          p_contact_ids: string[]
          p_names: string[]
        }
        Returns: Json
      }
      set_group_primary_contact: {
        Args: { p_account_id: string; p_group_id: string; p_member_id: string }
        Returns: Json
      }
      set_primary_group_membership: {
        Args: { p_account_id: string; p_member_id: string }
        Returns: Json
      }
      start_agency_visit: {
        Args: {
          p_account_id: string
          p_actor: string
          p_actor_name: string
          p_reason: string
          p_session: string
        }
        Returns: string
      }
      start_document_request_upload: {
        Args: {
          p_account_id: string
          p_bytes: number
          p_content_type: string
          p_item_key: string
          p_original_name: string
          p_request_id: string
          p_title: string
        }
        Returns: Json
      }
      sweep_jobs: { Args: { p_limit: number }; Returns: number }
      undismiss_duplicate_pair: {
        Args: { p_account_id: string; p_actor?: string; p_flag_id: string }
        Returns: Json
      }
      undo_ai_booking_act: {
        Args: {
          p_account_id: string
          p_act_id: string
          p_by: string
          p_now: string
        }
        Returns: string
      }
      undo_ai_contact_created: {
        Args: { p_account_id: string; p_act_id: string }
        Returns: string
      }
      undo_contact_merge: {
        Args: { p_account_id: string; p_actor?: string; p_merge_id: number }
        Returns: Json
      }
      undo_set_business: {
        Args: {
          p_account_id: string
          p_added: string
          p_contact_id: string
          p_removed: Json
        }
        Returns: string
      }
      undo_staff_move: {
        Args: {
          p_account_id: string
          p_cancelled_at: string
          p_new_id: string
          p_now: string
          p_old_id: string
        }
        Returns: string
      }
      unfile_inbound_email: {
        Args: { p_account_id: string; p_id: string; p_message_id: string }
        Returns: boolean
      }
      unskip_document_requirement: {
        Args: { p_account_id: string; p_actor: string; p_skip_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  app: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

