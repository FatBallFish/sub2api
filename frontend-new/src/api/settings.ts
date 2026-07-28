import { getJSON } from "./client";

export interface LoginAgreementDocument {
  id: string;
  title: string;
  content_md: string;
}

export interface PublicSettings {
  registration_enabled?: boolean;
  email_verify_enabled?: boolean;
  invitation_code_enabled?: boolean;
  github_oauth_enabled?: boolean;
  google_oauth_enabled?: boolean;
  affiliate_enabled?: boolean;
  site_name?: string;
  site_logo?: string;
  api_base_url?: string;
  hide_ccs_import_button?: boolean;
  login_agreement_updated_at?: string;
  login_agreement_documents?: LoginAgreementDocument[];
  region_block_frontend_enabled?: boolean;
  region_block_frontend_blocked?: boolean;
  region_block_current_region?: string;
  table_default_page_size?: number;
  table_page_size_options?: number[];
}

export function getPublicSettings() {
  return getJSON<PublicSettings>("/settings/public");
}
