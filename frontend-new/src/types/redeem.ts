export interface RedeemResult {
  message: string;
  type: string;
  value: number;
  new_balance?: number;
  new_concurrency?: number;
  group_name?: string;
  validity_days?: number;
}

export interface RedeemHistoryItem {
  id: number;
  code: string;
  type: string;
  value: number;
  status: string;
  used_at: string;
  created_at: string;
  notes?: string;
  group_id?: number;
  validity_days?: number;
  group?: {
    id: number;
    name: string;
  };
}

export interface RedeemAccountProfile {
  id: number;
  balance: number;
  concurrency: number;
}
