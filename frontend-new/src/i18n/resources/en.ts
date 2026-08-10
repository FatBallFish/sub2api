const en = {
  common: {
    language: "Language",
    legalDocuments: {
      terms: "Terms of Service",
      usagePolicy: "Usage Policy",
      supportedRegions: "Supported Countries and Regions",
      serviceSpecificTerms: "Service-Specific Terms",
    },
    languageSwitcher: {
      triggerLabel: "Change language",
      options: {
        en: "English",
        zhCN: "简体中文",
        zhTW: "繁體中文",
        ja: "日本語",
      },
    },
  },
  public: {
    title: "Home",
  },
  auth: {
    title: "Sign in",
  },
  console: {
    title: "Console",
  },
  errors: {
    scoped: {
      auth: {
        INVALID_USER: "Unable to sign in with this user account.",
      },
      affiliate: {
        INVALID_USER: "Select a valid affiliate user.",
      },
      payment: {
        DAILY_LIMIT_EXCEEDED: "The daily payment limit has been reached.",
        INVALID_AMOUNT: "Enter a valid payment amount.",
        INVALID_STATUS: "This action is not available for the current order status.",
        NOT_FOUND: "The requested payment order was not found.",
      },
      subscription: {
        DAILY_LIMIT_EXCEEDED: "The subscription's daily usage limit has been reached.",
      },
      apiKeys: {},
    },
    unknown: "Something went wrong.",
    INVALID_CREDENTIALS: "The email or password is incorrect.",
    USER_NOT_ACTIVE: "This account is inactive.",
    USER_INACTIVE: "This account is inactive.",
    EMAIL_EXISTS: "An account with this email already exists.",
    EMAIL_RESERVED: "This email address cannot be used.",
    INVALID_EMAIL: "Enter a valid email address.",
    PASSWORD_TOO_SHORT: "The password must be at least 6 characters.",
    PASSWORD_REQUIRED: "Enter your password.",
    EMAIL_VERIFY_REQUIRED: "Email verification is required.",
    EMAIL_SUFFIX_NOT_ALLOWED: "This email domain is not allowed.",
    EMAIL_DOMAIN_REGISTRATION_LIMIT: "This email domain has reached its registration limit.",
    REGISTRATION_DISABLED: "Registration is currently disabled.",
    INVITATION_CODE_REQUIRED: "An invitation code is required.",
    INVITATION_CODE_INVALID: "The invitation code is invalid or has already been used.",
    OAUTH_INVITATION_REQUIRED: "An invitation code is required to complete registration.",
    CAPTCHA_PROVIDER_CONFLICT: "Security verification is temporarily unavailable.",
    BACKEND_MODE_ADMIN_ONLY: "Only administrators can sign in while backend mode is active.",
    SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
    INVALID_TOKEN: "The sign-in session is invalid.",
    TOKEN_EXPIRED: "The sign-in session has expired.",
    ACCESS_TOKEN_EXPIRED: "The sign-in session has expired.",
    TOKEN_REVOKED: "The sign-in session has been revoked.",
    REFRESH_TOKEN_INVALID: "The sign-in session is invalid. Please sign in again.",
    REFRESH_TOKEN_EXPIRED: "The sign-in session has expired. Please sign in again.",
    REFRESH_TOKEN_REUSED: "The sign-in session is no longer valid. Please sign in again.",
    SESSION_BINDING_MISMATCH: "Your network changed. Please sign in again.",
    UNAUTHORIZED: "Please sign in to continue.",
    FORBIDDEN: "You do not have permission to perform this action.",
    PAYMENT_DISABLED: "Payments are currently disabled.",
    BALANCE_PAYMENT_DISABLED: "Balance top-ups are currently disabled.",
    PLAN_NOT_AVAILABLE: "This subscription plan is no longer available.",
    PLAN_NOT_AVAILABLE_FOR_GROUPS: "This plan is not available for your groups.",
    ORDER_TYPE_MISMATCH: "The selected plan does not match this order type.",
    GROUP_NOT_FOUND: "The selected group is no longer available.",
    GROUP_TYPE_MISMATCH: "The selected group does not support subscriptions.",
    TOO_MANY_PENDING: "Too many payment orders are pending. Try again later.",
    PAYMENT_GATEWAY_ERROR: "The payment gateway is temporarily unavailable.",
    NO_AVAILABLE_INSTANCE: "No payment channel is currently available.",
    PAYMENT_PROVIDER_MISCONFIGURED: "The payment provider is not configured correctly.",
    CANCEL_RATE_LIMITED: "Too many cancellation attempts. Try again later.",
    GLOBAL_PLAN_USE_UPGRADE_FLOW: "Use the plan upgrade flow to change this subscription.",
    API_KEY_NOT_FOUND: "The API key was not found.",
    GROUP_NOT_ALLOWED: "You cannot bind an API key to this group.",
    API_KEY_EXISTS: "This API key already exists.",
    API_KEY_TOO_SHORT: "The API key must be at least 16 characters.",
    API_KEY_INVALID_CHARS: "The API key can contain only letters, numbers, underscores, and hyphens.",
    API_KEY_RATE_LIMITED: "Too many failed API key attempts. Try again later.",
    API_KEY_AUTH_OVERLOADED: "API key authentication is temporarily unavailable.",
    INVALID_IP_PATTERN: "Enter a valid IP address or CIDR range.",
    API_KEY_REQUIRED: "An API key is required.",
    API_KEY_DISABLED: "This API key is disabled.",
    API_KEY_INACTIVE: "This API key is inactive.",
    API_KEY_EXPIRED: "This API key has expired.",
    API_KEY_QUOTA_EXHAUSTED: "This API key has exhausted its quota.",
    API_KEY_RATE_5H_EXCEEDED: "This API key has reached its 5-hour usage limit.",
    API_KEY_RATE_1D_EXCEEDED: "This API key has reached its daily usage limit.",
    API_KEY_RATE_7D_EXCEEDED: "This API key has reached its 7-day usage limit.",
    INSUFFICIENT_BALANCE: "The account balance is insufficient.",
    RATE_LIMITED: "Too many requests. Please slow down and try again later.",
    USER_NOT_FOUND: "The user account was not found.",
    AUTH_REQUIRED: "Sign in is required for this action.",
    PASSWORD_INCORRECT: "The current password is incorrect.",
    INSUFFICIENT_PERMISSIONS: "You do not have sufficient permission for this action.",
    INVALID_API_KEY: "The API key is invalid.",
    INVALID_AUTH_RATE_LIMITED: "Too many invalid authentication attempts. Try again later.",
    INVALID_AUTH_HEADER: "The authorization header is invalid.",
    EMPTY_TOKEN: "The access token is empty.",
    ACCESS_DENIED: "Access was denied.",
    SUBSCRIPTION_NOT_FOUND: "No active subscription was found.",
    NOTIFY_CODE_USER_RATE_LIMIT: "Too many verification codes were requested. Try again later.",
  },
} as const;

type StringResourceShape<T> = {
  [Key in keyof T]: T[Key] extends string
    ? string
    : T[Key] extends Record<string, unknown>
      ? StringResourceShape<T[Key]>
      : never;
};

export type TranslationResource = StringResourceShape<typeof en>;

type ResourceLeafKey<T> = {
  [Key in keyof T & string]: T[Key] extends string
    ? Key
    : T[Key] extends Record<string, unknown>
      ? `${Key}.${ResourceLeafKey<T[Key]>}`
      : never;
}[keyof T & string];

export type ErrorTranslationKey = ResourceLeafKey<typeof en.errors>;
export type ErrorFallbackKey = {
  [Key in keyof typeof en.errors]: (typeof en.errors)[Key] extends string ? Key : never;
}[keyof typeof en.errors];
export type TranslationKey = {
  [Namespace in keyof typeof en & string]: `${Namespace}:${ResourceLeafKey<(typeof en)[Namespace]>}`;
}[keyof typeof en & string];

export default en;
