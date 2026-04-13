export type ActivityType = '영업' | '재무' | '투자' | '개인' | '현금' | '세무'
export type NormalSide = 'debit' | 'credit'

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          name: string
          activity_type: ActivityType
          normal_side: NormalSide
          increase_type: string
          increase_label: string
          decrease_type: string
          decrease_label: string
          note: string | null
          is_active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['accounts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['accounts']['Insert']>
      }
      projects: {
        Row: {
          id: string
          code: string
          name: string
          description: string | null
          is_active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['projects']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['projects']['Insert']>
      }
      entities: {
        Row: {
          id: string
          name: string
          type: 'corporate' | 'personal'
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['entities']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['entities']['Insert']>
      }
      counterparties: {
        Row: {
          id: string
          name: string
          representative: string | null
          business_no: string | null
          email: string | null
          bank_name: string | null
          bank_account_no: string | null
          registered_at: string | null
          note: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['counterparties']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['counterparties']['Insert']>
      }
      bank_accounts: {
        Row: {
          id: string
          name: string
          bank: string
          account_no: string | null
          entity_id: string | null
          is_active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['bank_accounts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['bank_accounts']['Insert']>
      }
      journals: {
        Row: {
          id: string
          journal_no: number
          date: string
          description: string | null
          project_id: string | null
          entity_id: string | null
          is_cancelled: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['journals']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['journals']['Insert']>
      }
      journal_lines: {
        Row: {
          id: string
          journal_id: string
          date: string
          classification: string
          activity_type: ActivityType
          activity_subtype: string
          account_id: string
          debit: number
          credit: number
          counterparty_id: string | null
          counterparty_name: string | null
          note: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['journal_lines']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['journal_lines']['Insert']>
      }
      loans: {
        Row: {
          id: string
          name: string
          counterparty_id: string | null
          project_id: string | null
          principal: number | null
          interest_rate: number | null
          start_date: string | null
          end_date: string | null
          loan_type: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['loans']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['loans']['Insert']>
      }
    }
    Views: {
      account_balances: {
        Row: {
          account_id: string
          account_name: string
          activity_type: ActivityType
          normal_side: NormalSide
          total_debit: number
          total_credit: number
          balance: number
        }
        Relationships: []
      }
      project_balances: {
        Row: {
          project_id: string
          project_code: string
          project_name: string
          total_debit: number
          total_credit: number
        }
        Relationships: []
      }
      monthly_cashflow: {
        Row: {
          month: string
          project_id: string | null
          activity_type: ActivityType
          activity_subtype: string
          total_debit: number
          total_credit: number
        }
        Relationships: []
      }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
