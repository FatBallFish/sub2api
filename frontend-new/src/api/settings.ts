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
  turnstile_enabled?: boolean;
  turnstile_site_key?: string;
  tencent_captcha_enabled?: boolean;
  tencent_captcha_app_id?: string;
  aliyun_captcha_enabled?: boolean;
  aliyun_captcha_scene_id?: string;
  aliyun_captcha_prefix?: string;
  aliyun_captcha_region?: string;
  site_name?: string;
  site_logo?: string;
  api_base_url?: string;
  contact_info?: string;
  hide_ccs_import_button?: boolean;
  oidc_console_oauth_enabled?: boolean;
  oidc_oauth_enabled?: boolean;
  linuxdo_oauth_enabled?: boolean;
  wechat_oauth_enabled?: boolean;
  dingtalk_oauth_enabled?: boolean;
  password_login_disabled?: boolean;
  oidc_console_oauth_provider_name?: string;
  login_agreement_enabled?: boolean;
  login_agreement_mode?: "modal" | "checkbox" | string;
  login_agreement_updated_at?: string;
  login_agreement_revision?: string;
  login_agreement_documents?: LoginAgreementDocument[];
  region_block_frontend_enabled?: boolean;
  region_block_frontend_blocked?: boolean;
  region_block_current_region?: string;
  table_default_page_size?: number;
  table_page_size_options?: number[];
  model_plaza_enabled?: boolean;
  model_plaza_require_auth?: boolean;
}

export function getPublicSettings() {
  return getJSON<PublicSettings>("/settings/public");
}
