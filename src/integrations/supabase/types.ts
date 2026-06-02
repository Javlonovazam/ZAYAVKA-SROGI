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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      departments: {
        Row: {
          active: boolean
          created_at: string
          icon: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          icon?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          icon?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      order_history: {
        Row: {
          action: string
          created_at: string
          from_department: string | null
          id: string
          note: string | null
          order_id: string
          to_department: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          from_department?: string | null
          id?: string
          note?: string | null
          order_id: string
          to_department?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          from_department?: string | null
          id?: string
          note?: string | null
          order_id?: string
          to_department?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          comment: string
          created_at: string
          current_department: string
          deadline: string | null
          doors_count: number
          entered_current_dept_at: string
          filial: string
          finished_at: string | null
          id: string
          number: string
          pogonaj_required: boolean
          pogonaj_status: string
          position_deadlines: Json
          previous_department: string | null
          product_type: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          comment?: string
          created_at?: string
          current_department?: string
          deadline?: string | null
          doors_count?: number
          entered_current_dept_at?: string
          filial?: string
          finished_at?: string | null
          id?: string
          number: string
          pogonaj_required?: boolean
          pogonaj_status?: string
          position_deadlines?: Json
          previous_department?: string | null
          product_type?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          comment?: string
          created_at?: string
          current_department?: string
          deadline?: string | null
          doors_count?: number
          entered_current_dept_at?: string
          filial?: string
          finished_at?: string | null
          id?: string
          number?: string
          pogonaj_required?: boolean
          pogonaj_status?: string
          position_deadlines?: Json
          previous_department?: string | null
          product_type?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          login_dept: string | null
          login_password_plain: string | null
          system_role: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          login_dept?: string | null
          login_password_plain?: string | null
          system_role?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          login_dept?: string | null
          login_password_plain?: string | null
          system_role?: string
        }
        Relationships: []
      }
      user_departments: {
        Row: {
          created_at: string
          department_key: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_key: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_key?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_departments_department_key_fkey"
            columns: ["department_key"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["key"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          role: string
          user_id: string
        }
        Update: {
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_general: { Args: { _uid: string }; Returns: boolean }
      reschedule_telegram_cron: {
        Args: { hour_utc: number }
        Returns: undefined
      }
      user_has_dept: { Args: { _dept: string; _uid: string }; Returns: boolean }
    }
    Enums: {
      order_status: "pending_accept" | "in_progress" | "delivered"
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
      order_status: ["pending_accept", "in_progress", "delivered"],
    },
  },
} as const
